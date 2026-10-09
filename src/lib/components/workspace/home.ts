import type HomeType from './Home.svelte';

let Home: typeof HomeType | undefined;
export const getHome = () => Home;
export const loadHome = async () => (Home ??= (await import('./Home.svelte')).default);
