/**
 * Handlers de navegação
 */

export async function handleNavigateTo(data) {
  const { url } = data;
  window.location.href = url;
  return { navigating: true, url };
}

export async function handleGoBack() {
  window.history.back();
  return { action: 'back' };
}

export async function handleGoForward() {
  window.history.forward();
  return { action: 'forward' };
}

export async function handleRefresh() {
  window.location.reload();
  return { action: 'refresh' };
}

export function handleGetCurrentUrl() {
  return {
    url: window.location.href,
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash
  };
}
