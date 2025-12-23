import express, { Request, Response } from "express";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";
import * as admin from "firebase-admin";
import cors from "cors";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Your Agora App ID and App Certificate
const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

// Initialize Firebase Admin SDK
const firebaseConfig = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
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

// Send FCM Notification Endpoint
app.post("/send-notification", async (req: Request, res: Response) => {
  try {
    const { receiverId, senderName, messagePreview, messageId } = req.body;

    // Fetch receiver data
    const receiverRef = db.ref(`users/${receiverId}`);
    const snapshot = await receiverRef.once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ error: `User ${receiverId} not found` });
    }

    const userData = snapshot.val();

    const fcmToken = userData?.fcmToken;

    if (!fcmToken) {
      return res.status(400).json({
        error: "No fcmToken found",
        userKeys: Object.keys(userData || {})
      });
    }

    const message = {
      token: fcmToken,
      notification: { title: senderName, body: messagePreview },
      data: { messageId: messageId || "", senderName, timestamp: Date.now().toString() }
    };

    const response = await messaging.send(message);

    if (response === 'Invalid registration token detected') {
      // Clean invalid token
      await receiverRef.child('fcmToken').remove();
      return res.status(410).json({ error: 'Invalid FCM token - client needs to refresh' });
    }

    res.json({ success: true, messageId: response });
  } catch (error) {
    console.error("Full error:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});


// Send Notification to Multiple Recipients
app.post("/send-notification-batch", async (req: Request, res: Response) => {
  try {
    const { receiverIds, senderName, messagePreview, messageId } = req.body;

    if (!receiverIds || !Array.isArray(receiverIds) || !senderName) {
      return res.status(400).json({
        error: "receiverIds (array) and senderName are required",
      });
    }

    const fcmTokens: string[] = [];

    // Get FCM tokens for all receivers
    for (const receiverId of receiverIds) {
      const receiverSnapshot = await db
        .ref(`users/${receiverId}`)
        .once("value");
      const receiverData = receiverSnapshot.val();

      if (receiverData && receiverData.fcmToken) {
        fcmTokens.push(receiverData.fcmToken);
      }
    }

    if (fcmTokens.length === 0) {
      return res
        .status(404)
        .json({ error: "No valid FCM tokens found for receivers" });
    }

    // Send notifications
    const message = {
      tokens: fcmTokens,
      notification: {
        title: senderName,
        body: messagePreview,
        sound: "default" // Add this
      },
      data: {
        messageId: messageId || "",
        senderName: senderName,
        timestamp: new Date().getTime().toString(),
        sound: "default", // Data payload too
        click_action: "FLUTTER_NOTIFICATION_CLICK" // For deep linking
      },
      android: {
        priority: "high" as const,
        notification: { sound: "default" }
      },
      apns: {
        payload: {
          aps: { sound: "default" }
        }
      }
    };


    const response = await messaging.sendEachForMulticast(message);

    console.log("Batch notifications sent:", response);

    res.json({
      success: true,
      message: "Notifications sent",
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (error) {
    console.error("Error sending batch notifications:", error);
    res.status(500).json({
      error: "Failed to send notifications",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Health Check Endpoint
app.get("/health", (req: Request, res: Response) =>
  res.send("Server is running")
);

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
