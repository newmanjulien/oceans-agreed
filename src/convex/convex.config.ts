import { defineApp } from 'convex/server';
import { v } from 'convex/values';

export default defineApp({
	env: {
		CLERK_SECRET_KEY: v.optional(v.string()),
		CLERK_WEBHOOK_SIGNING_SECRET: v.optional(v.string()),
		CLERK_JWT_ISSUER_DOMAIN: v.optional(v.string()),
		APPROVAL_EMAIL: v.optional(v.string()),
		APP_URL: v.optional(v.string()),
		SMTP_USER: v.optional(v.string()),
		SMTP_APP_PASSWORD: v.optional(v.string())
	}
});
