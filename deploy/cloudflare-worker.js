export default {
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path === '/' || path === '') path = '/index.html';
    if (!path.startsWith('/')) path = '/' + path;

    // Serve legacy or docs based on path
    let html = '';
    if (path === '/legacy' || path === '/legacy/') {
      html = `LEGACY_HTML_PLACEHOLDER`;
    } else if (path === '/docs' || path === '/docs-index.html') {
      html = `DOCS_HTML_PLACEHOLDER`;
    } else {
      html = `ROOT_HTML_PLACEHOLDER`;
    }

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
};