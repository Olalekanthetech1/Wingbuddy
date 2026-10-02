import { Router, type IRouter } from "express";
import healthRouter from "./health";
import keysRouter from "./keys";
import providerKeysRouter from "./provider-keys";
import dashboardRouter from "./dashboard";
import envRouter from "./env";
import executionRouter from "./execution";
import modelsRouter from "./models";
import providersRouter from "./providers";
import aiRoutingRouter from "./ai-routing";
import simulatorRouter from "./simulator";
import behaviorConfigRouter from "./behavior-config";
import proactiveAssistantRouter from "./proactive-assistant";
import mediaStorageRouter from "./media-storage";
import knowledgeRouter from "./knowledge";
import userAccessRouter from "./user-access";
import personasRouter from "./personas";
import diagnosticsRouter from "./diagnostics";
import authRouter from "./auth";
import userRouter from "./user";
import reactionThemeRouter from "./reaction-theme";
import mediaRouter from "./media";
import { requireAdmin } from "../middlewares/auth.middleware";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/user", userRouter);
router.use("/media", mediaRouter);
router.use(reactionThemeRouter);
router.use(dashboardRouter);
router.use(simulatorRouter);
router.use(mediaStorageRouter);
router.use(knowledgeRouter);
router.use(personasRouter);

// Role-gated Administration & Diagnostics
router.use(requireAdmin, keysRouter);
router.use(requireAdmin, providerKeysRouter);
router.use(requireAdmin, envRouter);
router.use(requireAdmin, executionRouter);
router.use(requireAdmin, modelsRouter);
router.use(requireAdmin, providersRouter);
router.use(requireAdmin, aiRoutingRouter);
router.use(requireAdmin, behaviorConfigRouter);
router.use(requireAdmin, proactiveAssistantRouter);
router.use(requireAdmin, userAccessRouter);
router.use(requireAdmin, diagnosticsRouter);

export default router;
