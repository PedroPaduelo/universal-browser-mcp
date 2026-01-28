# Universal Browser MCP

Extensão Chrome + MCP Server que permite ao Claude AI controlar **qualquer site** da web.

## Arquitetura

```
┌─────────────────┐     stdio      ┌─────────────────┐   WebSocket   ┌─────────────────┐
│   Claude AI     │ ◄────────────► │   MCP Server    │ ◄───────────► │ Chrome Extension│
│ (Desktop/Code)  │                │   (Node.js)     │  :3002        │ (Content Script)│
└─────────────────┘                └─────────────────┘               └────────┬────────┘
                                                                              │
                                                                              ▼
                                                                     ┌─────────────────┐
                                                                     │  Qualquer Site  │
                                                                     └─────────────────┘
```

## Instalação

### 1. MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 2. Chrome Extension

1. Abra `chrome://extensions/` no Chrome
2. Ative "Modo do desenvolvedor"
3. Clique em "Carregar sem compactação"
4. Selecione a pasta `browser-extension/`

### 3. Configurar Claude Desktop

Adicione ao arquivo de configuração do Claude Desktop (`~/.config/claude-desktop/config.json` no Linux ou `~/Library/Application Support/Claude/claude_desktop_config.json` no Mac):

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/caminho/para/universal-browser-mcp/mcp-server/dist/server.js"]
    }
  }
}
```

## Uso

### 1. Inicie o servidor

O servidor inicia automaticamente quando o Claude Desktop conecta via MCP.

### 2. Abra qualquer site no Chrome

A extensão conecta automaticamente ao servidor (indicador verde no canto superior direito).

### 3. Peça ao Claude para interagir

Exemplos:
- "Vá para google.com e pesquise por 'clima em São Paulo'"
- "Preencha o formulário de login com email test@test.com"
- "Clique no botão 'Enviar'"
- "Extraia os dados da tabela de produtos"

## Tools Disponíveis

### Navegação
| Tool | Descrição |
|------|-----------|
| `navigate_to` | Navega para uma URL |
| `go_back` | Volta na história |
| `go_forward` | Avança na história |
| `refresh` | Recarrega a página |
| `get_current_url` | Retorna URL atual |

### Informação da Página
| Tool | Descrição |
|------|-----------|
| `get_page_info` | Estrutura completa (forms, buttons, links) |
| `get_page_title` | Título da página |
| `get_page_text` | Texto visível |

### Interação
| Tool | Descrição |
|------|-----------|
| `fill_field` | Preenche um campo |
| `fill_form` | Preenche múltiplos campos |
| `click_element` | Clica em elemento |
| `select_option` | Seleciona em dropdown |
| `type_text` | Digita caractere por caractere |
| `hover_element` | Mouse hover |
| `scroll_to` | Scroll até elemento |

### Espera
| Tool | Descrição |
|------|-----------|
| `wait_for_element` | Aguarda elemento aparecer |
| `wait_for_text` | Aguarda texto aparecer |

### Extração
| Tool | Descrição |
|------|-----------|
| `extract_text` | Extrai texto de elemento |
| `extract_table` | Extrai tabela como JSON |
| `extract_links` | Lista todos os links |
| `extract_form_data` | Valores atuais do form |

## Indicador de Status

O indicador visual no canto superior direito da página mostra:

- 🔄 **Laranja**: Conectando ao servidor
- ✅ **Verde**: Conectado e pronto
- ❌ **Vermelho**: Desconectado
- ⚙️ **Azul**: Processando comando

Clique no indicador para ver informações de debug.

## Estrutura do Projeto

```
universal-browser-mcp/
├── README.md
├── browser-extension/
│   ├── manifest.json       # Permissões universais
│   ├── content-script.js   # Manipulação do DOM
│   ├── background.js       # Service worker
│   ├── popup.html          # UI do popup
│   └── popup.js
└── mcp-server/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── server.ts       # MCP Server
        └── websocket/
            └── bridge-server.ts
```

## Fluxo Recomendado

1. Use `get_connection_status` para verificar conexão
2. Use `get_page_info` para entender a estrutura da página
3. Use `fill_field`/`click_element` para interagir
4. Use `wait_for_element` após navegações
5. Use `extract_*` para obter dados

## Limitações

- Não funciona em páginas `chrome://`, `chrome-extension://`, etc.
- CAPTCHAs não são resolvidos automaticamente
- Shadow DOM pode requerer tratamento especial
- iframes podem não ser acessíveis

## Licença

MIT
