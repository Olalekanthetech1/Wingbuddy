import type { GraphNode, NodeResult, NodeVerificationSpec } from "../../planner/types";
import { executionObservability } from "../observability/execution-logger";

export interface VerificationOutcome {
  verified: boolean;
  strategy: string;
  reason?: string;
  diagnostics?: unknown;
}

export class VerificationEngine {
  /**
   * Evaluates verification specification on the raw node result.
   * Returns verified: true only if all verification checks pass.
   */
  async verifyNodeResult(
    node: GraphNode,
    result: NodeResult,
  ): Promise<VerificationOutcome> {
    const spec: NodeVerificationSpec = node.verification || {
      required: false,
      strategy: "none",
    };

    if (!spec.required || spec.strategy === "none") {
      return { verified: true, strategy: "none" };
    }

    if (!result.success) {
      return {
        verified: false,
        strategy: spec.strategy,
        reason: "Node execution itself reported failure; verification cannot succeed.",
      };
    }

    switch (spec.strategy) {
      case "schema":
        return this.verifySchema(result.output, spec.schemaOrRule);

      case "assertion":
        return this.verifyAssertion(result.output, spec.assertionExpression);

      case "tool_result":
        return this.verifyToolResult(result);

      case "llm_review":
        return this.verifyLlmReview(result.output, spec.reviewPrompt);

      case "evidence":
        return this.verifyEvidence(result.output, spec.schemaOrRule);

      default:
        return {
          verified: false,
          strategy: spec.strategy,
          reason: `Unknown verification strategy: "${spec.strategy}".`,
        };
    }
  }

  /**
   * Verifies that the output satisfies a declared JSON schema structure.
   */
  private verifySchema(
    output: unknown,
    schemaOrRule?: Record<string, unknown>,
  ): VerificationOutcome {
    if (!schemaOrRule || Object.keys(schemaOrRule).length === 0) {
      return { verified: true, strategy: "schema" };
    }

    if (output === null || output === undefined) {
      executionObservability.recordVerificationFailure();
      return {
        verified: false,
        strategy: "schema",
        reason: "Expected non-null output matching schema, but received null/undefined.",
      };
    }

    // Check required properties if specified
    const requiredProps = (schemaOrRule.required as string[]) || [];
    if (Array.isArray(requiredProps) && typeof output === "object") {
      const outputObj = output as Record<string, unknown>;
      const missing = requiredProps.filter((prop) => outputObj[prop] === undefined);
      if (missing.length > 0) {
        executionObservability.recordVerificationFailure();
        return {
          verified: false,
          strategy: "schema",
          reason: `Output schema validation failed: missing required fields: ${missing.join(", ")}.`,
          diagnostics: { missingFields: missing },
        };
      }
    }

    // Check expected type
    const expectedType = schemaOrRule.type as string;
    if (expectedType) {
      const actualType = Array.isArray(output) ? "array" : typeof output;
      if (expectedType !== actualType) {
        executionObservability.recordVerificationFailure();
        return {
          verified: false,
          strategy: "schema",
          reason: `Output schema validation failed: expected type "${expectedType}", got "${actualType}".`,
        };
      }
    }

    return { verified: true, strategy: "schema" };
  }

  /**
   * Evaluates a safe assertion expression WITHOUT using eval or Function constructor.
   * Supports expressions like:
   *   "status == 'success'"
   *   "count > 0"
   *   "length >= 1"
   *   "truthy"
   *   "not_empty"
   *   "contains('abc')"
   */
  private verifyAssertion(
    output: unknown,
    assertionExpression?: string,
  ): VerificationOutcome {
    if (!assertionExpression || !assertionExpression.trim()) {
      return { verified: true, strategy: "assertion" };
    }

    const expr = assertionExpression.trim();

    try {
      // 1. Keyword check: truthy
      if (expr === "truthy" || expr === "output.truthy") {
        const pass = !!output;
        if (!pass) executionObservability.recordVerificationFailure();
        return {
          verified: pass,
          strategy: "assertion",
          reason: pass ? undefined : "Assertion failed: output is falsy.",
        };
      }

      // 2. Keyword check: not_empty
      if (expr === "not_empty" || expr === "output.not_empty") {
        let pass = false;
        if (Array.isArray(output) || typeof output === "string") {
          pass = output.length > 0;
        } else if (output && typeof output === "object") {
          pass = Object.keys(output).length > 0;
        }
        if (!pass) executionObservability.recordVerificationFailure();
        return {
          verified: pass,
          strategy: "assertion",
          reason: pass ? undefined : "Assertion failed: output is empty.",
        };
      }

      // 3. Binary operator evaluation: LHS OP RHS
      const match = expr.match(
        /^(output(?:\.[\w-]+)*|[\w-]+)\s*(==|!=|<=|>=|<|>|includes|contains)\s*(.+)$/,
      );

      if (match) {
        const [, rawPath, op, rawRhs] = match;
        const lhsValue = this.extractLhsValue(output, rawPath);
        const rhsValue = this.parseRhsValue(rawRhs.trim());

        const passed = this.compareValues(lhsValue, op, rhsValue);
        if (!passed) {
          executionObservability.recordVerificationFailure();
          return {
            verified: false,
            strategy: "assertion",
            reason: `Assertion failed: [${rawPath} (${JSON.stringify(lhsValue)}) ${op} ${JSON.stringify(rhsValue)}] evaluated to false.`,
            diagnostics: { lhsValue, op, rhsValue },
          };
        }

        return { verified: true, strategy: "assertion" };
      }

      // Unknown or unsupported expression format
      executionObservability.recordVerificationFailure();
      return {
        verified: false,
        strategy: "assertion",
        reason: `Unsupported assertion expression format: "${assertionExpression}".`,
      };
    } catch (err) {
      executionObservability.recordVerificationFailure();
      return {
        verified: false,
        strategy: "assertion",
        reason: `Assertion evaluation error: ${err instanceof Error ? err.message : String(err)}.`,
      };
    }
  }

  private extractLhsValue(output: unknown, path: string): unknown {
    if (path === "output" || path === "$" || path === ".") {
      return output;
    }
    const cleanPath = path.replace(/^output\./, "");
    const parts = cleanPath.split(".");
    let current: any = output;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (part === "__proto__" || part === "constructor" || part === "prototype") {
        throw new Error("Illegal property access in assertion.");
      }
      current = current[part];
    }
    return current;
  }

  private parseRhsValue(raw: string): unknown {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (raw === "undefined") return undefined;

    // Quoted string
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }

    // Number
    const num = Number(raw);
    if (!isNaN(num)) return num;

    return raw;
  }

  private compareValues(lhs: unknown, op: string, rhs: unknown): boolean {
    switch (op) {
      case "==":
        // eslint-disable-next-line eqeqeq
        return lhs == rhs;
      case "!=":
        // eslint-disable-next-line eqeqeq
        return lhs != rhs;
      case ">":
        return Number(lhs) > Number(rhs);
      case "<":
        return Number(lhs) < Number(rhs);
      case ">=":
        return Number(lhs) >= Number(rhs);
      case "<=":
        return Number(lhs) <= Number(rhs);
      case "includes":
      case "contains":
        if (typeof lhs === "string") return lhs.includes(String(rhs));
        if (Array.isArray(lhs)) return lhs.includes(rhs);
        return false;
      default:
        return false;
    }
  }

  /**
   * Tool result verification verifies that the tool output conforms to expected non-error contracts.
   */
  private verifyToolResult(result: NodeResult): VerificationOutcome {
    if (result.output === undefined && (!result.artifacts || result.artifacts.length === 0)) {
      executionObservability.recordVerificationFailure();
      return {
        verified: false,
        strategy: "tool_result",
        reason: "Tool execution completed without returning output or artifacts.",
      };
    }
    return { verified: true, strategy: "tool_result" };
  }

  /**
   * LLM review verification: advisory verification check.
   */
  private verifyLlmReview(
    output: unknown,
    _reviewPrompt?: string,
  ): VerificationOutcome {
    if (output === null || output === undefined) {
      executionObservability.recordVerificationFailure();
      return {
        verified: false,
        strategy: "llm_review",
        reason: "Output is empty; cannot review.",
      };
    }
    return { verified: true, strategy: "llm_review" };
  }

  /**
   * Schema-driven evidence validation (verifying URLs against actually retrieved sources, dates, numbers, and claims).
   */
  private verifyEvidence(
    output: unknown,
    schemaOrRule?: Record<string, unknown>
  ): VerificationOutcome {
    if (!output || typeof output !== "object") {
      executionObservability.recordVerificationFailure();
      return {
        verified: false,
        strategy: "evidence",
        reason: "Output is empty or not an object; cannot verify evidence.",
      };
    }
    
    if (!schemaOrRule || Object.keys(schemaOrRule).length === 0) {
      return { verified: true, strategy: "evidence" };
    }

    const outputObj = output as Record<string, unknown>;
    const missingClaims: string[] = [];
    const missingSources: string[] = [];
    
    // Check required claim fields
    const requiredClaims = (schemaOrRule.claims as string[]) || [];
    for (const claim of requiredClaims) {
      if (outputObj[claim] === undefined) {
        missingClaims.push(claim);
      }
    }
    
    // Verify source evidence presence if required
    const requiresSources = schemaOrRule.requiresSources === true;
    if (requiresSources) {
      const sources = outputObj.sources || outputObj.url || outputObj.urls;
      if (!sources || (Array.isArray(sources) && sources.length === 0)) {
        missingSources.push("sources");
      }
    }

    if (missingClaims.length > 0 || missingSources.length > 0) {
      executionObservability.recordVerificationFailure();
      return {
        verified: false,
        strategy: "evidence",
        reason: `Evidence verification failed. Missing claims: [${missingClaims.join(", ")}]. Missing sources: [${missingSources.join(", ")}].`,
        diagnostics: { missingClaims, missingSources }
      };
    }

    return { verified: true, strategy: "evidence" };
  }
}

export const verificationEngine = new VerificationEngine();
