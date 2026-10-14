import { runModels } from "../packages/cli/src/models.js";

process.exitCode = await runModels(process.argv.slice(2));
