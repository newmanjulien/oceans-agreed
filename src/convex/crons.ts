import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons = cronJobs();
crons.interval(
	'reconcile Clerk accounts and resume cleanup',
	{ minutes: 15 },
	internal.clerk.reconcile,
	{}
);
export default crons;
