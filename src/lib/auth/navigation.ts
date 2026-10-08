export function localReturn(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value))
		return '/';
	const url = new URL(value, 'https://agreed.invalid');
	if (url.origin !== 'https://agreed.invalid' || ['/login', '/join'].includes(url.pathname))
		return '/';
	return url.pathname + url.search + url.hash;
}
