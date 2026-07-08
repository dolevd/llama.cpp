import { ROUTES } from '$lib/constants/routes';

export class RouterService {
	static chat(id: string): string {
		return `${ROUTES.CHAT}/${id}`;
	}

	static conversation(conversation: { id: string; mode?: string }): string {
		return conversation.mode === 'story' ? this.story(conversation.id) : this.chat(conversation.id);
	}

	static isStoryRoute(routeId?: string | null): boolean {
		return routeId?.startsWith('/(chat)/story') ?? false;
	}

	static settings(section: string): string {
		return `${ROUTES.SETTINGS}/${section}`;
	}

	static story(id: string): string {
		return `${ROUTES.STORY}/${id}`;
	}
}
