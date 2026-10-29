import { createHash } from 'node:crypto';

const MAX_BYTES = 3_750_000;
const MAGIC = {
    'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/png': b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': b =>
        b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export function validateImage(block) {
    if (!block || block.type !== 'image') return 'not an image block';
    if (!MAGIC[block.mimeType]) return `unsupported mimeType ${JSON.stringify(String(block.mimeType).slice(0, 40))}`;
    if (typeof block.data !== 'string' || block.data.length === 0) return 'empty image data';
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(block.data) || block.data.length % 4 !== 0)
        return 'data is not canonical base64';
    const bytes = Buffer.from(block.data, 'base64');
    if (bytes.length > MAX_BYTES) return `image too large (${bytes.length} bytes > ${MAX_BYTES})`;
    if (!MAGIC[block.mimeType](bytes)) return `bytes do not match ${block.mimeType}`;
    return null;
}

const describe = block => ({
    mimeType: block?.mimeType,
    chars: typeof block?.data === 'string' ? block.data.length : null,
    sha256: typeof block?.data === 'string' ? createHash('sha256').update(block.data).digest('hex').slice(0, 16) : null,
});

export function sanitizeImages(messages, { allowImages = true } = {}) {
    const removed = [];
    const out = messages.map((message, index) => {
        if (!Array.isArray(message?.content) || !message.content.some(c => c?.type === 'image')) return message;
        const content = message.content.map(block => {
            if (block?.type !== 'image') return block;
            let reason =
                message.role === 'toolResult'
                    ? 'tool-result images are rejected by this model route'
                    : validateImage(block);
            if (!reason && !allowImages) reason = 'images disabled for this retry after an image-related 400';
            if (!reason && message.role === 'user') return block;
            reason ??= `images are not sent in ${message.role} messages`;
            removed.push({ index, role: message.role, toolName: message.toolName, reason, ...describe(block) });
            return {
                type: 'text',
                text: `[image omitted: ${reason}. The current observation carries the freshest first-person view when available.]`,
            };
        });
        return { ...message, content };
    });
    return { messages: out, removed };
}

export function isImageRejection(message) {
    const text = String(message ?? '');
    return (
        /\(400\)|"?status(?:Code)?"?\s*[:=]\s*400\b/i.test(text) &&
        /image field|image content|does(?:n'|n\\'|\s+no)t\s+support\s+(?:the\s+)?image/i.test(text)
    );
}

export function redactPayloads(text) {
    return String(text ?? '').replace(
        /(data:[a-z/+-]+;base64,)?[A-Za-z0-9+/]{400,}={0,2}/g,
        m => `<base64 ${m.length} chars sha256=${createHash('sha256').update(m).digest('hex').slice(0, 16)}>`,
    );
}
