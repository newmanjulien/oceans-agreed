import type { AuthObject } from '@clerk/backend';
import type { ContractRouteData } from '$lib/contract/saved';

declare global {
	namespace App {
		interface Locals {
			auth?: () => AuthObject;
		}
		interface PageData {
			contractRoute?: ContractRouteData;
		}
	}
}

export {};
