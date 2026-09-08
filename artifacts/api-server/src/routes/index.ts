import { Router, type IRouter } from "express";
import healthRouter from "./health";
import keysRouter from "./keys";
import dashboardRouter from "./dashboard";
import envRouter from "./env";

const router: IRouter = Router();

router.use(healthRouter);
router.use(keysRouter);
router.use(dashboardRouter);
router.use(envRouter);

export default router;
