import type { ApiChatCompletionTool } from '$lib/types/api';

export const STORY_INITIAL_PROMPT = `Attached is a snippet from a fantasy story.
Your task is to write a novella sized story continuing from this snippet, keeping the same tone and style as the provided snippet.

To do this, first write a summary of your suggestion, and after the user approves, write the actual story chapter by chapter.`;

export const STORY_OUTLINE_TOOL_NAME = 'submit_story_outline';

export const STORY_OUTLINE_TOOL: ApiChatCompletionTool = {
	type: 'function',
	function: {
		name: STORY_OUTLINE_TOOL_NAME,
		description:
			'Submit the proposed story title, overall summary, and chapter-by-chapter outline for user approval.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				title: {
					type: 'string',
					description: 'The proposed title for the story.'
				},
				summary: {
					type: 'string',
					description: 'A concise summary of the complete proposed story arc.'
				},
				chapters: {
					type: 'array',
					minItems: 1,
					description: 'The proposed chapter outline, in order.',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							title: {
								type: 'string',
								description: 'The proposed chapter title.'
							},
							summary: {
								type: 'string',
								description: 'The chapter outline to use later for chapter generation.'
							}
						},
						required: ['title', 'summary']
					}
				}
			},
			required: ['title', 'summary', 'chapters']
		}
	}
};

export const STORY_OUTLINE_TOOL_INSTRUCTION = `Use the ${STORY_OUTLINE_TOOL_NAME} tool to submit the story title, story summary, and chapter summaries. Do not write the outline as normal prose; call the tool with the structured outline.`;

export const STORY_FIRST_CHAPTER_PROMPT_PREFIX =
	'Approved. Please write the first chapter based on the following outline:\n\n';

export const STORY_NEXT_CHAPTER_PROMPT_PREFIX =
	'Please write the next chapter based on the following outline:\n\n';
