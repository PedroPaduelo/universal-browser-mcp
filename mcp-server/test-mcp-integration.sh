#!/bin/bash
# MCP Integration Test Script
# Tests the MCP server endpoint via Streamable HTTP transport
#
# Usage: ./test-mcp-integration.sh [port]
# Default port: 8080

PORT=${1:-8080}
BASE_URL="http://localhost:$PORT/mcp"
PASSED=0
FAILED=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() {
  echo -e "${GREEN}PASS${NC}: $1"
  ((PASSED++))
}

fail() {
  echo -e "${RED}FAIL${NC}: $1 - $2"
  ((FAILED++))
}

echo "=== MCP Integration Tests ==="
echo "Server: $BASE_URL"
echo ""

# Test 1: Initialize
echo "--- Test 1: Initialize ---"
INIT_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "test-client", "version": "1.0.0" }
    }
  }' 2>&1)

if echo "$INIT_RESPONSE" | grep -q '"protocolVersion"'; then
  pass "Initialize returns protocol version"
else
  fail "Initialize" "Missing protocolVersion in response: $INIT_RESPONSE"
fi

# Extract session ID from response headers
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i 'mcp-session-id' | head -1 | awk '{print $2}' | tr -d '\r')

# If no session from headers, try a second request
if [ -z "$SESSION_ID" ]; then
  # Use -i to include headers
  INIT_WITH_HEADERS=$(curl -s -i -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "id": 2,
      "method": "initialize",
      "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "test-client", "version": "1.0.0" }
      }
    }' 2>&1)

  SESSION_ID=$(echo "$INIT_WITH_HEADERS" | grep -i 'mcp-session-id' | head -1 | sed 's/.*: //' | tr -d '\r\n')
fi

if [ -n "$SESSION_ID" ]; then
  pass "Got session ID: $SESSION_ID"
else
  fail "Session ID" "No mcp-session-id header found"
  echo "Note: Some tests may fail without session ID"
  SESSION_ID="test-session"
fi

# Test 2: List Tools
echo ""
echo "--- Test 2: List Tools ---"
TOOLS_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/list",
    "params": {}
  }' 2>&1)

TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    tools = data.get('result', {}).get('tools', [])
    print(len(tools))
except:
    print(0)
" 2>/dev/null)

if [ "$TOOL_COUNT" -ge 60 ] 2>/dev/null; then
  pass "tools/list returns $TOOL_COUNT tools (expected >= 60)"
else
  fail "tools/list" "Expected >= 60 tools, got: $TOOL_COUNT"
fi

# Test 3: Check all descriptions are in English
echo ""
echo "--- Test 3: All Descriptions in English ---"
PT_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    tools = data.get('result', {}).get('tools', [])
    pt_words = ['Retorna', 'Navega', 'Aguarda', 'Extrai', 'Configura', 'Habilita', 'Limpa', 'Verifica', 'Captura']
    count = 0
    for tool in tools:
        desc = tool.get('description', '')
        for word in pt_words:
            if word in desc:
                count += 1
                print(f'  PT found in {tool[\"name\"]}: {word}', file=sys.stderr)
                break
    print(count)
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    print(-1)
" 2>&1)

if [ "$PT_COUNT" = "0" ]; then
  pass "All tool descriptions are in English"
elif [ "$PT_COUNT" -gt 0 ] 2>/dev/null; then
  fail "English descriptions" "$PT_COUNT tools still have Portuguese descriptions"
else
  fail "English descriptions" "Could not parse tools response"
fi

# Test 4: Call create_automation_session
echo ""
echo "--- Test 4: create_automation_session ---"
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "create_automation_session",
      "arguments": { "url": "https://example.com" }
    }
  }' 2>&1)

if echo "$CREATE_RESPONSE" | grep -q '"content"'; then
  pass "create_automation_session returns content"
else
  fail "create_automation_session" "Missing content in response"
fi

# Test 5: Call close_automation_session
echo ""
echo "--- Test 5: close_automation_session ---"
CLOSE_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "close_automation_session",
      "arguments": {}
    }
  }' 2>&1)

if echo "$CLOSE_RESPONSE" | grep -q '"content"'; then
  pass "close_automation_session returns content"
else
  fail "close_automation_session" "Missing content in response"
fi

# Summary
echo ""
echo "=== Summary ==="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo "Total:  $((PASSED + FAILED))"

if [ $FAILED -gt 0 ]; then
  exit 1
fi
