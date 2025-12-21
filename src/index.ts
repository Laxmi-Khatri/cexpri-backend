import express, { Request, Response } from "express";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";

const app = express();
const port = process.env.PORT || 3000;

// Your Agora App ID and App Certificate
const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

app.get("/token", (req: Request, res: Response) => {
  const channelName = req.query.channelName as string;
  if (!channelName) {
    return res.status(400).json({ error: "channelName is required" });
  }

  const uid = req.query.uid ? parseInt(req.query.uid as string) : 0;
  const role = RtcRole.PUBLISHER;
  const expirationTimeInSeconds = 3600; // 1 hour
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  if (!APP_ID || !APP_CERTIFICATE) {
    return res
      .status(500)
      .json({ error: "Agora App ID or Certificate is not set" });
  }

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    uid,
    role,
    privilegeExpiredTs
  );
  res.json({ token: token });
});

app.get("/health", (req: Request, res: Response) =>
  res.send("Agora token server is running")
);

app.listen(port, () => {
  console.log(`Agora token server listening at http://localhost:${port}`);
});
