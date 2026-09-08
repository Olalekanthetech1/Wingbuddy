import { Router, type IRouter } from "express";
import healthRouter from "./health";
import keysRouter from "./keys";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(keysRouter);
router.use(dashboardRouter);

export default router;
