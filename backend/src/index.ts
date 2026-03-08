import http from "http";
import { app } from "./app";
import { env } from "./config/env";
import { setupLiveCameraSignaling } from "./services/liveCameraSignaling";

const server = http.createServer(app);
setupLiveCameraSignaling(server);

server.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Backend listening on http://0.0.0.0:${env.PORT}`);
});

