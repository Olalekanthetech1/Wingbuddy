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

const router: IRouter = Router();

router.use(healthRouter);
router.use(keysRouter);
router.use(providerKeysRouter);
router.use(dashboardRouter);
router.use(envRouter);
router.use(executionRouter);
router.use(modelsRouter);
router.use(providersRouter);
router.use(aiRoutingRouter);
router.use(simulatorRouter);
router.use(behaviorConfigRouter);
router.use(proactiveAssistantRouter);
router.use(mediaStorageRouter);
router.use(knowledgeRouter);

export default router;
