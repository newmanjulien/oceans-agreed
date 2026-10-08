import { tick } from 'svelte';

let activeScrollLocks = 0;
let previousBodyOverflow = '';

type ModalBehaviorOptions = {
	isOpen: () => boolean;
	onClose: () => void;
};

export function createModalBehavior({ isOpen, onClose }: ModalBehaviorOptions) {
	let dialogElement = $state<HTMLDivElement | null>(null);
	let previouslyFocusedElement: HTMLElement | null = null;

	$effect(() => {
		if (!isOpen()) {
			return;
		}

		previouslyFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		lockBodyScroll();
		void focusDialogAfterRender();

		return () => {
			unlockBodyScroll();
			previouslyFocusedElement?.focus();
			previouslyFocusedElement = null;
		};
	});

	async function focusDialogAfterRender() {
		await tick();
		(getFocusableElements()[0] ?? dialogElement)?.focus();
	}

	function getFocusableElements() {
		if (!dialogElement) {
			return [];
		}

		return Array.from(
			dialogElement.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => element.tabIndex >= 0);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen()) {
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}

		if (event.key === 'Tab') {
			trapFocus(event);
		}
	}

	function trapFocus(event: KeyboardEvent) {
		const focusableElements = getFocusableElements();
		const firstElement = focusableElements[0] ?? dialogElement;
		const lastElement = focusableElements.at(-1) ?? dialogElement;
		const activeElement = document.activeElement;

		if (!dialogElement || !firstElement || !lastElement) {
			return;
		}

		if (!dialogElement.contains(activeElement)) {
			event.preventDefault();
			firstElement.focus();
			return;
		}

		if (event.shiftKey && activeElement === firstElement) {
			event.preventDefault();
			lastElement.focus();
			return;
		}

		if (!event.shiftKey && activeElement === lastElement) {
			event.preventDefault();
			firstElement.focus();
		}
	}

	return {
		get dialogElement() {
			return dialogElement;
		},
		set dialogElement(element: HTMLDivElement | null) {
			dialogElement = element;
		},
		handleKeydown
	};
}

function lockBodyScroll() {
	if (activeScrollLocks === 0) {
		previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
	}

	activeScrollLocks += 1;
}

function unlockBodyScroll() {
	activeScrollLocks = Math.max(0, activeScrollLocks - 1);

	if (activeScrollLocks === 0) {
		document.body.style.overflow = previousBodyOverflow;
		previousBodyOverflow = '';
	}
}
