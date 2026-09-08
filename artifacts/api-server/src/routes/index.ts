import { Router, type IRouter } from "express";
import healthRouter from "./health";
import keysRouter from "./keys";
import dashboardRouter from "./dashboard";
import envRouter from "./env";
import executionRouter from "./execution";
import modelsRouter from "./models";

const router: IRouter = Router();

router.use(healthRouter);
router.use(keysRouter);
router.use(dashboardRouter);
router.use(envRouter);
router.use(executionRouter);
router.use(modelsRouter);

export default router;
