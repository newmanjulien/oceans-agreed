import type { PathnameWithSearchOrHash, RouteIdWithSearchOrHash } from '$app/types';

export type ButtonHref = PathnameWithSearchOrHash | RouteIdWithSearchOrHash;
export type ButtonSize = 'sm' | 'icon-sm';
export type ButtonType = 'button' | 'submit' | 'reset';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
