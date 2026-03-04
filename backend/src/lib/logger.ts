import morgan from "morgan";

// Only log request metadata; never include request bodies or sensitive payloads.
export const httpLogger = morgan(":method :url :status :response-time ms");

