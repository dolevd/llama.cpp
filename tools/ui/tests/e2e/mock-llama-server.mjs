import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const DEFAULT_PORT = 8181;
const DEFAULT_DIST = './dist';
const MOCK_MODEL = 'mock-llama-e2e.gguf';
const STARTED_AT = Math.floor(Date.now() / 1000);

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? DEFAULT_PORT);
const host = String(args.host ?? '::');
const distDir = resolve(args.dist ?? DEFAULT_DIST);
const requestLog = [];
const sockets = new Set();

if (args.build) {
	runBuild();
}

const contentTypes = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.js', 'application/javascript; charset=utf-8'],
	['.mjs', 'application/javascript; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.webmanifest', 'application/manifest+json; charset=utf-8'],
	['.svg', 'image/svg+xml'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.ico', 'image/x-icon'],
	['.wasm', 'application/wasm'],
	['.txt', 'text/plain; charset=utf-8'],
	['.map', 'application/json; charset=utf-8']
]);

const scenarios = {
	default: {
		content: ['This ', 'is ', 'a mock ', 'streaming ', 'response.']
	},
	reasoning: {
		reasoning: ['Considering ', 'the test prompt.'],
		content: ['Reasoning ', 'stream ', 'complete.']
	},
	toolCall: {
		toolCalls: [
			{
				index: 0,
				id: 'call_mock_weather',
				type: 'function',
				function: { name: 'get_weather', arguments: '' }
			},
			{
				index: 0,
				function: { arguments: '{"city":"Paris"}' }
			}
		],
		content: ['Tool-call ', 'stream ', 'complete.']
	}
};

const server = createServer(async (req, res) => {
	try {
		await handleRequest(req, res);
	} catch (error) {
		console.error(error);
		sendJson(res, 500, { error: { message: 'Mock server error' } });
	}
});

server.listen(port, host, () => {
	console.log(`Mock llama.cpp e2e server listening on http://localhost:${port}`);
	console.log(`Serving static files from ${distDir}`);
	if (!args['no-parent-watchdog']) {
		startParentWatchdog();
	}
});

server.on('connection', (socket) => {
	sockets.add(socket);
	socket.on('close', () => sockets.delete(socket));
});

async function handleRequest(req, res) {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${port}`}`);
	const pathname = normalizePathname(url.pathname);

	if (req.method === 'OPTIONS') {
		res.writeHead(204, defaultHeaders());
		res.end();
		return;
	}

	if (pathname === '/__mock/requests') {
		if (req.method === 'GET') {
			sendJson(res, 200, {
				requests: requestLog,
				chatCompletions: requestLog.filter((entry) => entry.path === '/v1/chat/completions')
			});
			return;
		}

		if (req.method === 'DELETE') {
			requestLog.length = 0;
			sendJson(res, 200, { success: true });
			return;
		}
	}

	if (req.method === 'GET' && pathname === '/props') {
		recordRequest(req, pathname, null);
		sendJson(res, 200, buildProps(url.searchParams.get('model')));
		return;
	}

	if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
		recordRequest(req, pathname, null);
		sendJson(res, 200, buildModels());
		return;
	}

	if (req.method === 'GET' && pathname === '/slots') {
		recordRequest(req, pathname, null);
		sendJson(res, 200, [{ id: 0, is_processing: false }]);
		return;
	}

	if (req.method === 'GET' && pathname === '/tools') {
		recordRequest(req, pathname, null);
		sendJson(res, 200, []);
		return;
	}

	if (req.method === 'POST' && pathname === '/v1/chat/completions/control') {
		const body = await readJsonBody(req);
		recordRequest(req, pathname, body);
		sendJson(res, 200, { success: true });
		return;
	}

	if (req.method === 'POST' && pathname === '/v1/chat/completions') {
		const body = await readJsonBody(req);
		recordRequest(req, pathname, body);
		await handleChatCompletion(res, body);
		return;
	}

	await serveStatic(req, res, pathname);
}

async function handleChatCompletion(res, body) {
	const validationError = validateChatCompletionRequest(body);
	if (validationError) {
		sendJson(res, 400, { error: { message: validationError } });
		return;
	}

	const scenario = selectScenario(body);
	const content = scenario.content.join('');
	const reasoning = scenario.reasoning?.join('');

	if (!body.stream) {
		sendJson(res, 200, {
			id: nextCompletionId(),
			object: 'chat.completion',
			created: Math.floor(Date.now() / 1000),
			model: body.model || MOCK_MODEL,
			choices: [
				{
					index: 0,
					message: {
						role: 'assistant',
						content,
						...(reasoning ? { reasoning_content: reasoning } : {})
					},
					finish_reason: 'stop'
				}
			]
		});
		return;
	}

	await streamChatCompletion(res, body, scenario);
}

async function streamChatCompletion(res, body, scenario) {
	const id = nextCompletionId();
	const model = body.model || MOCK_MODEL;
	let predicted = 0;

	res.writeHead(200, {
		...defaultHeaders(),
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no'
	});

	writeSse(res, {
		id,
		object: 'chat.completion.chunk',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
		prompt_progress: { progress: 1, processed: 1, total: 1 }
	});

	for (const reasoningChunk of scenario.reasoning ?? []) {
		predicted++;
		await delay(90);
		writeSse(res, buildChunk({ id, model, reasoningContent: reasoningChunk, predicted }));
	}

	for (const toolCall of scenario.toolCalls ?? []) {
		predicted++;
		await delay(90);
		writeSse(res, buildChunk({ id, model, toolCalls: [toolCall], predicted }));
	}

	for (const contentChunk of scenario.content) {
		predicted++;
		await delay(120);
		writeSse(res, buildChunk({ id, model, content: contentChunk, predicted }));
	}

	await delay(60);
	writeSse(res, {
		id,
		object: 'chat.completion.chunk',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
		timings: buildTimings(predicted)
	});
	res.write('data: [DONE]\n\n');
	res.end();
}

function buildChunk({ id, model, content, reasoningContent, toolCalls, predicted }) {
	return {
		id,
		object: 'chat.completion.chunk',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				delta: {
					...(content ? { content } : {}),
					...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
					...(toolCalls ? { tool_calls: toolCalls } : {})
				},
				finish_reason: null
			}
		],
		timings: buildTimings(predicted)
	};
}

function buildTimings(predicted) {
	return {
		prompt_n: 12,
		prompt_ms: 8,
		predicted_n: predicted,
		predicted_ms: Math.max(predicted * 25, 1),
		cache_n: 0
	};
}

function buildProps(model) {
	return {
		default_generation_settings: {
			id: 0,
			id_task: 0,
			n_ctx: 4096,
			speculative: false,
			is_processing: false,
			params: {
				n_predict: -1,
				seed: 0,
				temperature: 0.8,
				dynatemp_range: 0,
				dynatemp_exponent: 1,
				top_k: 40,
				top_p: 0.95,
				min_p: 0.05,
				top_n_sigma: -1,
				xtc_probability: 0,
				xtc_threshold: 0.1,
				typ_p: 1,
				repeat_last_n: 64,
				repeat_penalty: 1,
				presence_penalty: 0,
				frequency_penalty: 0,
				dry_multiplier: 0,
				dry_base: 1.75,
				dry_allowed_length: 2,
				dry_penalty_last_n: -1,
				dry_sequence_breakers: ['\n', ':', '"', '*'],
				mirostat: 0,
				mirostat_tau: 5,
				mirostat_eta: 0.1,
				stop: [],
				max_tokens: -1,
				n_keep: 0,
				n_discard: 0,
				ignore_eos: false,
				stream: true,
				logit_bias: [],
				n_probs: 0,
				min_keep: 0,
				grammar: '',
				grammar_lazy: false,
				grammar_triggers: [],
				preserved_tokens: [],
				chat_format: 'chatml',
				reasoning_format: 'auto',
				reasoning_in_content: false,
				generation_prompt: '',
				samplers: ['top_k', 'tfs_z', 'typ_p', 'top_p', 'min_p', 'temperature'],
				backend_sampling: false,
				'speculative.n_max': 16,
				'speculative.n_min': 0,
				'speculative.p_min': 0.75,
				timings_per_token: false,
				post_sampling_probs: false,
				lora: []
			},
			prompt: '',
			next_token: {
				has_next_token: false,
				has_new_line: false,
				n_remain: -1,
				n_decoded: 0,
				stopping_word: ''
			}
		},
		total_slots: 1,
		model_path: model || MOCK_MODEL,
		model_alias: model || MOCK_MODEL,
		role: 'model',
		modalities: {
			vision: false,
			audio: false,
			video: false
		},
		chat_template:
			'{% for message in messages %}<|im_start|>{{ message.role }}\n{{ message.content }}<|im_end|>{% endfor %}',
		bos_token: '<s>',
		eos_token: '</s>',
		build_info: 'mock-e2e',
		ui_settings: {
			titleGenerationUseLLM: false,
			preEncodeConversation: false
		},
		cors_proxy_enabled: false
	};
}

function buildModels() {
	return {
		object: 'list',
		data: [
			{
				id: MOCK_MODEL,
				object: 'model',
				owned_by: 'llamacpp',
				created: STARTED_AT,
				in_cache: true,
				path: `/models/${MOCK_MODEL}`,
				status: { value: 'loaded' },
				aliases: ['mock-llama-e2e'],
				tags: ['e2e'],
				meta: {}
			}
		],
		models: [
			{
				name: 'Mock llama.cpp E2E',
				model: MOCK_MODEL,
				description: 'Deterministic mock model for Playwright tests',
				capabilities: ['completion'],
				details: {
					family: 'mock',
					parameter_size: '0B',
					quantization_level: 'Q0'
				}
			}
		]
	};
}

function selectScenario(body) {
	const text = body.messages
		.map((message) => {
			if (typeof message.content === 'string') return message.content;
			if (Array.isArray(message.content)) {
				return message.content
					.map((part) => (part && typeof part.text === 'string' ? part.text : ''))
					.join(' ');
			}
			return '';
		})
		.join(' ')
		.toLowerCase();

	if (text.includes('mock-scenario: reasoning')) return scenarios.reasoning;
	if (text.includes('mock-scenario: tool-call')) return scenarios.toolCall;
	return scenarios.default;
}

function validateChatCompletionRequest(body) {
	if (!body || typeof body !== 'object') return 'Expected a JSON request body';
	if (!Array.isArray(body.messages)) return 'Expected messages to be an array';
	for (const [index, message] of body.messages.entries()) {
		if (!message || typeof message !== 'object') return `Message ${index} must be an object`;
		if (typeof message.role !== 'string') return `Message ${index} must include a role`;
		if (message.content === undefined || message.content === null) {
			return `Message ${index} must include content`;
		}
	}

	return null;
}

async function serveStatic(req, res, pathname) {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		sendJson(res, 405, { error: { message: 'Method not allowed' } });
		return;
	}

	let filePath = resolveStaticPath(pathname);
	if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
		filePath = resolve(distDir, 'index.html');
	}

	if (!isInsideDist(filePath) || !existsSync(filePath)) {
		sendJson(res, 404, { error: { message: 'Not found' } });
		return;
	}

	const headers = {
		...defaultHeaders(),
		'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
	};

	res.writeHead(200, headers);
	if (req.method === 'HEAD') {
		res.end();
		return;
	}

	createReadStream(filePath).pipe(res);
}

function resolveStaticPath(pathname) {
	const decoded = decodeURIComponent(pathname);
	const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
	const candidate = resolve(join(distDir, relativePath));
	return isInsideDist(candidate) ? candidate : null;
}

function isInsideDist(filePath) {
	const normalizedDist = distDir.endsWith(sep) ? distDir : `${distDir}${sep}`;
	return filePath === distDir || filePath.startsWith(normalizedDist);
}

async function readJsonBody(req) {
	const raw = await readBody(req);
	if (!raw.trim()) return null;

	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString('utf8');
}

function recordRequest(req, path, body) {
	requestLog.push({
		method: req.method,
		path,
		body,
		createdAt: new Date().toISOString()
	});

	if (requestLog.length > 100) {
		requestLog.shift();
	}
}

function sendJson(res, status, payload) {
	res.writeHead(status, {
		...defaultHeaders(),
		'Content-Type': 'application/json; charset=utf-8'
	});
	res.end(JSON.stringify(payload));
}

function writeSse(res, payload) {
	res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function defaultHeaders() {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type,Authorization',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Opener-Policy': 'same-origin'
	};
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePathname(pathname) {
	return pathname.replace(/\/+$/, '') || '/';
}

function nextCompletionId() {
	return `chatcmpl-mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseArgs(argv) {
	const parsed = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;

		const key = arg.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith('--')) {
			parsed[key] = next;
			i++;
		} else {
			parsed[key] = true;
		}
	}
	return parsed;
}

function runBuild() {
	const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
	const commandArgs =
		process.platform === 'win32' ? ['/c', 'npm', 'run', 'build'] : ['run', 'build'];
	const result = spawnSync(command, commandArgs, { stdio: 'inherit' });

	if (result.error) {
		console.error(result.error);
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function shutdown() {
	for (const socket of sockets) {
		socket.destroy();
	}
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 500).unref();
}

function startParentWatchdog() {
	const parentPid = process.ppid;
	setInterval(() => {
		try {
			process.kill(parentPid, 0);
		} catch {
			shutdown();
		}
	}, 1000).unref();
}

if (!args['no-parent-watchdog']) {
	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
	process.on('SIGHUP', shutdown);
	process.on('SIGBREAK', shutdown);
}

if (!process.stdin.isTTY && !args['no-parent-watchdog']) {
	process.stdin.resume();
	process.stdin.on('end', shutdown);
	process.stdin.on('close', shutdown);
}
