// Swagger configuration for Express API documentation
const swaggerJSDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Whatsapp Backend API",
      version: "1.0.0",
      description: "API documentation for Whatsapp Backend",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Paste your JWT access token here (no need to type 'Bearer'). Most /api endpoints require this.",
        },
      },
      schemas: {
        SignupRequest: {
          type: "object",
          required: [
            "firstName",
            "username",
            "email",
            "timezone",
            "password",
            "confirmPassword",
            "termsAccepted",
          ],
          properties: {
            firstName: { type: "string", example: "Rahul" },
            lastName: { type: "string", example: "Roy" },
            username: { type: "string", example: "rahul_roy" },
            email: {
              type: "string",
              format: "email",
              example: "rahul@example.com",
            },
            phone: { type: "string", example: "+919876543210" },
            timezone: { type: "string", example: "Asia/Kolkata" },
            password: { type: "string", example: "StrongPass123" },
            confirmPassword: { type: "string", example: "StrongPass123" },
            termsAccepted: { type: "boolean", example: true },
          },
          example: {
            firstName: "Rahul",
            lastName: "Roy",
            username: "rahul_roy",
            email: "rahul@example.com",
            phone: "+919876543210",
            timezone: "Asia/Kolkata",
            password: "StrongPass123",
            confirmPassword: "StrongPass123",
            termsAccepted: true,
          },
        },
        SigninRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: {
              type: "string",
              format: "email",
              example: "rahul@example.com",
            },
            password: { type: "string", example: "StrongPass123" },
            rememberMe: { type: "boolean", example: true },
          },
          example: {
            email: "rahul@example.com",
            password: "StrongPass123",
            rememberMe: true,
          },
        },
        SendMessageRequest: {
          type: "object",
          required: ["userId", "to", "message"],
          properties: {
            userId: { type: "string", example: "66f0c8f9e4b9b2b1c1234567" },
            to: { type: "string", example: "+919812345678" },
            message: { type: "string", example: "Hello from API" },
          },
        },
        ReplyMessageRequest: {
          type: "object",
          required: ["userId", "messageId", "replyText"],
          properties: {
            userId: { type: "string", example: "66f0c8f9e4b9b2b1c1234567" },
            messageId: {
              type: "string",
              example: "true_919812345678@c.us_3EB0A1A2345678901234",
            },
            replyText: { type: "string", example: "Got it, thanks!" },
          },
        },
        SendLocationRequest: {
          type: "object",
          required: ["userId", "to", "latitude", "longitude"],
          properties: {
            userId: { type: "string", example: "66f0c8f9e4b9b2b1c1234567" },
            to: { type: "string", example: "+919812345678" },
            latitude: { type: "number", example: 28.6139 },
            longitude: { type: "number", example: 77.209 },
            description: { type: "string", example: "India Gate" },
          },
        },
        BroadcastRequest: {
          type: "object",
          required: ["userId", "recipients", "message"],
          properties: {
            userId: { type: "string", example: "66f0c8f9e4b9b2b1c1234567" },
            recipients: {
              type: "array",
              items: { type: "string" },
              example: ["+919812345678", "+919876543210"],
            },
            message: { type: "string", example: "Hello everyone!" },
          },
        },
        SendAttachmentRequest: {
          type: "object",
          required: ["userId", "to", "file"],
          properties: {
            userId: { type: "string" },
            to: { type: "string" },
            caption: { type: "string" },
            file: { type: "string", format: "binary" },
          },
        },
        SendBulkRequest: {
          type: "object",
          required: ["userId", "csvFile"],
          properties: {
            userId: { type: "string" },
            csvFile: { type: "string", format: "binary" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    servers: [
      {
        url: "http://localhost:5000",
        description: "Development server",
      },
    ],
  },
  apis: ["./src/routes/*.js", "./src/models/*.js"], // Path to the API docs
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = { swaggerUi, swaggerSpec };
