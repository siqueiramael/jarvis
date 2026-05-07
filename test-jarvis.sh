#!/bin/bash
BASE_URL="${1:-http://localhost:3000}"
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
PASSED=0
FAILED=0
test_endpoint() {
  local method=$1
  local endpoint=$2
  local expected=$3
  local response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" 2>/dev/null)
  local status=$(echo "$response" | tail -n 1)
  if [ "$status" = "$expected" ]; then
    echo -e "${GREEN}✅${NC} $method $endpoint"
    ((PASSED++))
  else
    echo -e "${RED}❌${NC} $method $endpoint (got $status)"
    ((FAILED++))
  fi
}
echo ""
echo "🧪 Testando JARVIS v2.0..."
echo ""
test_endpoint "GET" "/api/health" "200"
test_endpoint "GET" "/api/agents" "200"
test_endpoint "GET" "/api/system/stats" "200"
echo ""
echo "Resultado: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
echo ""
