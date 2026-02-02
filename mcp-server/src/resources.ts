/**
 * MCP Resources
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerResources(mcpServer: McpServer) {
  mcpServer.resource(
    'browser://instrucoes',
    'Instruções de uso do Universal Browser MCP',
    async () => ({
      contents: [{
        uri: 'browser://instrucoes',
        mimeType: 'text/markdown',
        text: `# Universal Browser MCP - Instruções (v2.0)

## Novidades da v2.0 - Sessões Isoladas

Agora o MCP usa **janelas dedicadas** para automação, permitindo:
- Navegar normalmente nas suas abas sem interferência
- Múltiplos Claude Code rodando ao mesmo tempo
- Isolamento completo entre sessões

## Fluxo Recomendado

1. **Crie uma sessão**: \`create_automation_session\` - Abre janela dedicada
2. **Entenda a página**: \`get_page_info\` para ver a estrutura
3. **Interaja**: \`fill_field\`, \`click_element\`, etc.
4. **Aguarde**: \`wait_for_element\` após cliques que causam navegação
5. **Extraia**: \`extract_table\`, \`extract_text\` para obter dados
6. **Feche**: \`close_automation_session\` quando terminar

## Dicas

- **SEMPRE** comece com \`create_automation_session\`
- Use \`get_automation_status\` para verificar o estado
- A janela de automação tem um ícone 🤖 no canto
- Você pode navegar nas suas abas normais sem problema

## Tools de Sessão
- create_automation_session: Cria janela dedicada
- close_automation_session: Fecha a sessão
- get_automation_status: Status completo

## Tools de Navegação
- navigate_to, go_back, go_forward, refresh, get_current_url

## Tools de Informação
- get_page_info, get_page_title, get_page_text

## Tools de Interação
- fill_field, fill_form, click_element, select_option, type_text, hover_element, scroll_to

## Tools de Espera
- wait_for_element, wait_for_text

## Tools de Extração
- extract_text, extract_table, extract_links, extract_form_data
`
      }]
    })
  );
}
