#!/bin/bash

echo "Telegram CLI Bridge Environment Check"
echo "===================================="
echo ""

PASS=0
WARN=0
FAIL=0

ok()   { echo "   ✅ $1"; ((PASS++)); }
warn() { echo "   ⚠️  $1"; ((WARN++)); }
fail() { echo "   ❌ $1"; ((FAIL++)); }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Check 1: Bun
echo "📦 Checking Bun..."
if command -v bun &> /dev/null; then
    ok "Bun installed: v$(bun --version)"
else
    fail "Bun not found"
    echo "   → Install: curl -fsSL https://bun.sh/install | bash"
fi

# Check 2: Dependencies
echo ""
echo "📚 Checking dependencies..."
if [ -d "$PROJECT_DIR/node_modules/grammy" ]; then
    ok "grammy installed"
else
    fail "grammy not found"
    echo "   → Run: cd $PROJECT_DIR && bun install"
fi

# Check 3: Bridge scripts
echo ""
echo "📄 Checking bridge scripts..."
for script in bridge.js codex-bridge.js gemini-bridge.js; do
    if [ -f "$PROJECT_DIR/$script" ]; then
        ok "$script"
    else
        warn "$script not found"
    fi
done

# Check 4: Environment files
echo ""
echo "🔑 Checking environment files..."
for envfile in .env .env.codex .env.gemini; do
    if [ -f "$PROJECT_DIR/$envfile" ]; then
        ok "$envfile exists"
    else
        warn "$envfile not found"
        echo "   → Copy from .env.example and fill in values"
    fi
done

# Check 5: Required env vars (check from .env files without exposing values)
echo ""
echo "🔐 Checking required variables..."
check_env_var() {
    local file="$1"
    local var="$2"
    if [ -f "$PROJECT_DIR/$file" ] && grep -q "^${var}=" "$PROJECT_DIR/$file"; then
        local val
        val=$(grep "^${var}=" "$PROJECT_DIR/$file" | cut -d= -f2-)
        if [ -n "$val" ] && [ "$val" != "your_token_here" ]; then
            ok "$var set in $file"
        else
            warn "$var is empty or placeholder in $file"
        fi
    else
        warn "$var not found in $file"
    fi
}

check_env_var ".env" "TELEGRAM_BOT_TOKEN"
check_env_var ".env" "OWNER_TELEGRAM_ID"
check_env_var ".env.codex" "TELEGRAM_BOT_TOKEN"
check_env_var ".env.gemini" "TELEGRAM_BOT_TOKEN"

# Check 6: task-api connectivity
echo ""
echo "🌐 Checking task-api connectivity..."
API_URL="${TASK_API_URL:-http://localhost:3456}"
if curl -sf --connect-timeout 3 "$API_URL/health" > /dev/null 2>&1; then
    ok "task-api reachable at $API_URL"
elif curl -sf --connect-timeout 3 "$API_URL/" > /dev/null 2>&1; then
    ok "task-api reachable at $API_URL (no /health endpoint)"
else
    warn "task-api not reachable at $API_URL"
    echo "   → Is openclaw-worker running? Check: curl $API_URL/health"
fi

# Summary
echo ""
echo "===================================="
echo "Results: ✅ $PASS passed | ⚠️  $WARN warnings | ❌ $FAIL failures"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
