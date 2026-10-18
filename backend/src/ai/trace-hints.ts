// Vercel ships only the files its tracer reaches from the entrypoint. @langchain/openai
// imports openai/lib/responses/ResponseInputItems.js through the openai package's wildcard
// "./lib/*.js" export, which the tracer doesn't follow (deployments failed with
// ERR_MODULE_NOT_FOUND). A relative path bypasses export resolution, so the tracer includes
// the file; it's the same file @langchain/openai resolves (openai is a direct dependency at
// the same version, so pnpm shares one copy).
import "../../node_modules/openai/lib/responses/ResponseInputItems.js";
