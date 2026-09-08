import { Router, type IRouter } from "express";
import healthRouter from "./health";
import keysRouter from "./keys";
import dashboardRouter from "./dashboard";
import envRouter from "./env";
import executionRouter from "./execution";
import modelsRouter from "./models";
import simulatorRouter from "./simulator";
import behaviorRouter from "./behavior";

const router: IRouter = Router();

router.use(healthRouter);
router.use(keysRouter);
router.use(dashboardRouter);
router.use(envRouter);
router.use(executionRouter);
router.use(modelsRouter);
router.use(simulatorRouter);
router.use(behaviorRouter);

export default router;
