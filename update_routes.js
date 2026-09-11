const fs = require('fs');
const file = 'artifacts/api-server/src/routes/index.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'import mediaStorageRouter from "./media-storage";',
  'import mediaStorageRouter from "./media-storage";\nimport knowledgeRouter from "./knowledge";'
);

code = code.replace(
  'router.use(mediaStorageRouter);',
  'router.use(mediaStorageRouter);\nrouter.use(knowledgeRouter);'
);

fs.writeFileSync(file, code);
console.log("Updated routes/index.ts");
