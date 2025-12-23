import express, { Request, Response } from "express";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";
import * as admin from "firebase-admin";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

/* -------------------- Middleware -------------------- */
app.use(cors());
app.use(express.json());

// Your Agora App ID and App Certificate
const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

/* -------------------- Firebase Admin Init -------------------- */
const firebaseConfig = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url:
    process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
};

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig as admin.ServiceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
const messaging = admin.messaging();

// Agora Token Endpoint
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

/* -------------------- WEB Notification (Single User) -------------------- */
/**
 * Body:
 * {
 *   "receiverId": "123",
 *   "title": "New Message",
 *   "body": "Hello from web"
 * }
 */
app.post("/send-notification", async (req: Request, res: Response) => {
  try {
    const { receiverId, messagePreview } = req.body;

    if (!receiverId ||  !messagePreview) {
      return res.status(400).json({
        error: "receiverId and messagePreview are required",
      });
    }

    /* ---- Fetch user from DB ---- */
    const userRef = db.ref(`users/${receiverId}`);
    const snapshot = await userRef.once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({
        error: `User ${receiverId} not found`,
      });
    }

    const userData = snapshot.val();
    const fcmToken = userData?.fcmToken;
    const notificationsEnabled = userData?.notificationsEnabled;

    if (!fcmToken) {
      return res.status(400).json({
        error: "FCM token not found for user",
      });
    }

    if(!notificationsEnabled){
      return res.status(400).json({
        error: "Notification disabled"
      })
    }

    /* ---- WEB PUSH MESSAGE ---- */
    const message = {
      token: fcmToken,
      notification: {
        title: "New Message",
        body: messagePreview,
      },
      webpush: {
        headers: {
          Urgency: "high",
        },
        notification: {
          title: "New Message",
          body: messagePreview,
          icon: "/icon.png",
          badge: "/badge.png",
        },
        fcmOptions: {
          link: "https://cexpri.web.app",
        },
      },
    };

    const response = await messaging.send(message);

    return res.json({
      success: true,
      messageId: response,
    });
  } catch (error) {
    console.error("Web notification error:", error);
    return res.status(500).json({
      error: "Failed to send web notification",
      details: error instanceof Error ? error.message : error,
    });
  }
});

/* -------------------- WEB Notification (By Token - GET) -------------------- */
/**
 * Example:
 * /send-notification-by-token?token=FCM_TOKEN&message=Hello
 */
app.get("/send-notification-by-token", async (req: Request, res: Response) => {
  try {
    if (!req.query.token || !req.query.message) {
      return res.status(400).json({ error: "token and message required" });
    }

    const fcmToken = decodeURIComponent(String(req.query.token));
    const messagePreview = String(req.query.message);

    console.log("FCM TOKEN:", fcmToken);

    const message = {
      token: fcmToken,
      notification: {
        title: "New Message",
        body: messagePreview,
      },
      webpush: {
        fcmOptions: {
          link: "https://cexpri.web.app",
        },
      },
    };

    const response = await messaging.send(message);

    res.json({ success: true, messageId: response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Send failed" });
  }
});


/* -------------------- Health Check -------------------- */
app.get("/health", (_: Request, res: Response) => {
  res.send("Server is running");
});

/* -------------------- Server -------------------- */
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
