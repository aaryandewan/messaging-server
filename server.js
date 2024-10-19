const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const mongoose = require("mongoose");
const { Schema } = mongoose;
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://flatmate-finder-zhzz.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://flatmate-finder-zhzz.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.log("MongoDB connection error:", err);
  });

// Chat Schema
const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    age: { type: Number, required: false },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      required: false,
    },
    location: { type: String },
    occupation: { type: String },
    hobbies: [{ type: String }],
    expectedRent: { type: Number },
    profilePicture: { type: String },
    additionalPhotos: [{ type: String }],
    instagramHandle: { type: String },
    phoneNumber: { type: String },
    sentRequests: [{ type: Schema.Types.ObjectId, ref: "ConnectionRequest" }],
    receivedRequests: [
      { type: Schema.Types.ObjectId, ref: "ConnectionRequest" },
    ],
    connections: [{ type: Schema.Types.ObjectId, ref: "User" }],
    isProfileComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const participantSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
});

const chatSchema = new mongoose.Schema({
  participants: [participantSchema],
  messages: [messageSchema], // Array of message objects
  lastMessage: {
    text: { type: String, required: true }, // Last message content
    timestamp: { type: Date, default: Date.now }, // Time of the last message
  },
});

const Chat = mongoose.model("Chat", chatSchema);
const User = mongoose.model("User", UserSchema);

// Socket.io logic
io.on("connection", (socket) => {
  console.log("New client connected", socket.id);

  // Join a specific flat room
  socket.on("joinRoom", async ({ flatId, userId, ownerId }) => {
    const participants = [userId, ownerId].sort();
    console.log("UserId = ", userId, " and ownerId = ", ownerId);
    const roomId = participants.join("-");
    socket.join(roomId);
    console.log(`${userId} joined room: ${roomId}`);
  });

  // Handle sending messages
  socket.on("sendMessage", async (data) => {
    const { senderId, receiverId, flatId, content } = data;
    const participants = [senderId, receiverId].sort();
    const roomId = participants.join("-");
    // const roomId = `${flatId}-${senderId}-${receiverId}`;
    console.log(
      "Sending message, senderId = ",
      senderId,
      " and receiverId = ",
      receiverId
    );

    try {
      let chat = await Chat.findOne({
        "participants.userId": { $all: [senderId, receiverId] },
      });

      if (!chat) {
        // Fetch sender and receiver
        const [sender, receiver] = await Promise.all([
          User.findById(senderId),
          User.findById(receiverId),
        ]);

        // Check if both users exist
        if (!sender || !receiver) {
          throw new Error("One or both users not found");
        }

        // Create a new chat
        chat = new Chat({
          participants: [
            { userId: sender._id, name: sender.name },
            { userId: receiver._id, name: receiver.name },
          ],
          messages: [],
          lastMessage: {
            text: content,
            timestamp: Date.now(),
          },
        });
      }

      // Add the message to the chat
      const newMessage = { senderId, text: content };
      chat.messages.push(newMessage);
      chat.lastMessage = {
        text: content,
        timestamp: Date.now(),
      };
      await chat.save();

      // Emit the message to the room
      io.to(roomId).emit("receiveMessage", newMessage);
    } catch (error) {
      console.error("Error sending message:", error);
      // You might want to emit an error event to the client here
      socket.emit("messageError", { message: "Failed to send message" });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
