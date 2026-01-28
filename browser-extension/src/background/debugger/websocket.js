/**
 * WebSocket capture functionality
 */

import { initDebuggerState, getDebuggerState } from './state.js';
import { enableNetworkCapture } from './network.js';

/**
 * Habilita monitoramento de WebSocket
 */
export async function enableWebSocketCapture(sessionId) {
  const state = initDebuggerState(sessionId);

  // WebSocket é capturado pelo Network.enable
  if (!state.networkEnabled) {
    await enableNetworkCapture(sessionId);
  }

  state.wsEnabled = true;
  state.wsFrames = [];

  console.log(`[Universal MCP] WebSocket capture enabled for session ${sessionId}`);

  return { success: true, message: 'WebSocket capture enabled' };
}

/**
 * Retorna frames WebSocket
 */
export function getWebSocketFrames(sessionId, options = {}) {
  const state = getDebuggerState(sessionId);
  if (!state) {
    return { frames: [], total: 0, hasMore: false };
  }

  let frames = state.wsFrames;

  if (options.urlFilter) {
    frames = frames.filter(f => f.url?.includes(options.urlFilter));
  }
  if (options.direction) {
    frames = frames.filter(f => f.direction === options.direction);
  }

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  return {
    frames: frames.slice(offset, offset + limit),
    total: frames.length,
    hasMore: frames.length > offset + limit
  };
}

/**
 * Processa WebSocket created
 */
export function handleWebSocketCreated(state, params) {
  const frame = {
    type: 'created',
    timestamp: Date.now(),
    url: params.url,
    requestId: params.requestId
  };
  if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
  state.wsFrames.push(frame);
}

/**
 * Processa frame sent
 */
export function handleWebSocketFrameSent(state, params) {
  const frame = {
    type: 'frame',
    direction: 'sent',
    timestamp: Date.now(),
    requestId: params.requestId,
    opcode: params.response.opcode,
    payloadData: params.response.payloadData?.substring(0, 10000)
  };
  if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
  state.wsFrames.push(frame);
}

/**
 * Processa frame received
 */
export function handleWebSocketFrameReceived(state, params) {
  const frame = {
    type: 'frame',
    direction: 'received',
    timestamp: Date.now(),
    requestId: params.requestId,
    opcode: params.response.opcode,
    payloadData: params.response.payloadData?.substring(0, 10000)
  };
  if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
  state.wsFrames.push(frame);
}

/**
 * Processa WebSocket closed
 */
export function handleWebSocketClosed(state, params) {
  const frame = {
    type: 'closed',
    timestamp: Date.now(),
    requestId: params.requestId
  };
  if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
  state.wsFrames.push(frame);
}
