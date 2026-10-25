// Pictures attached to a chat message: limits, checks, upload and thumbnail address.
import {agentUpload} from './agent_session.js';

export const ATTACH = {
    count: 4, bytes: 10 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'],
    add: ['Add pictures', '添加图片'], remove: ['Remove', '移除'],
    tooMany: ['Up to 4 pictures per message.', '一条消息最多 4 张图片。'],
    tooLarge: ['Each picture must be under 10 MB.', '每张图片不能超过 10 MB。'],
    notPicture: ['Only pictures can be added.', '只能添加图片。'],
    unreadable: ['Could not read this picture. Please choose another one.', '无法读取这张图片，请换一张。'],
    failed: ['Could not upload the picture. Click it to try again.', '图片上传失败，请点击该图片重试。'],
    retry: ['Upload again', '重新上传'],
    icon: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 16l4-4 4 4 3-3 5 5M15 9h.01',
};

// Splits files into the ones that fit and the first reason for leaving one out: {accepted, problem}.
export function pickPictures(files, room) {
    const accepted = []; let problem = null;
    for (const file of files) {
        if (!ATTACH.types.includes(file.type)) problem ||= 'notPicture';
        else if (file.size > ATTACH.bytes) problem ||= 'tooLarge';
        else if (accepted.length >= room) problem ||= 'tooMany';
        else accepted.push(file);
    }
    return {accepted, problem};
}

export const attachmentURL = (api, name) => {
    const path = '/freevideo/agent/chat/attachment?' + new URLSearchParams({name});
    return api.apiURL?.(path) || path;
};

// Resolves to the attachment object; rejects with {problem} naming a key of ATTACH.
export async function uploadPicture(api, file, signal) {
    let response;
    try { response = await agentUpload(api, '/freevideo/agent/chat/attach?' + new URLSearchParams({name: file.name || 'picture'}), file, signal); }
    catch (error) { if (signal?.aborted) throw {problem: null}; throw {problem: 'failed'}; }
    if (response.status === 201 || response.ok) {
        const value = await response.json().catch(() => null);
        if (value?.name) return value;
        throw {problem: 'failed'};
    }
    const code = (await response.json().catch(() => null))?.error?.code;
    throw {problem: code === 'too_large' ? 'tooLarge' : code === 'invalid_media' ? 'unreadable' : 'failed', code};
}

// A thumbnail that turns into a grey cell with the picture glyph when the picture cannot be shown.
export function thumbnail(src) {
    const cell = document.createElement('span'), image = document.createElement('img');
    cell.className = 'fv-chat-thumb'; image.alt = ''; image.draggable = false;
    image.addEventListener('error', () => { cell.dataset.broken = 'true'; image.remove(); cell.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ATTACH.icon}"/></svg>`; });
    image.src = src; cell.append(image);
    return cell;
}
