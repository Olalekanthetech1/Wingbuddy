import { afterEach, describe, expect, it, vi } from "vitest";
import { TavilyService } from "../src/services/tavily.service";

describe("TavilyService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TAVILY_TIMEOUT_MS;
  });

  it("fails truthfully when TAVILY_API_KEY is absent", async () => {
    const service = new TavilyService("");
    await expect(service.search({ query: "current AI news" })).rejects.toThrow("TAVILY_API_KEY");
  });

  it("preserves source-backed search results and filters empty URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "req-1",
      results: [
        { title: "Source A", url: "https://example.com/a", content: "Evidence A", score: 0.91, published_date: "2026-09-08" },
        { title: "No URL", url: "", content: "discard" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new TavilyService("test-key");
    const result = await service.search({ query: "latest AI model availability", maxResults: 5 });
    expect(result.provider).toBe("tavily");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ title: "Source A", url: "https://example.com/a", score: 0.91 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.tavily.com/search");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("retries transient provider failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ title: "Recovered", url: "https://example.com", content: "ok" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new TavilyService("test-key");
    const result = await service.search({ query: "retry test" });
    expect(result.results[0].title).toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent provider failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new TavilyService("test-key");
    await expect(service.search({ query: "auth test" })).rejects.toThrow("unauthorized");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts multiple known URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ url: "https://example.com/a", raw_content: "Full source text" }],
      failed_results: [],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new TavilyService("test-key");
    const result = await service.extract(["https://example.com/a", "https://example.com/a"]);
    expect(result.results).toMatchObject([{ url: "https://example.com/a", rawContent: "Full source text" }]);
  });
});
