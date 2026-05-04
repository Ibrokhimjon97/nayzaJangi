import re
import os

file_path = 'public/client.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Restore applyWallHit with proper artillery logic
apply_wall_fixed = '''function applyWallHit(ownerIndex, hitX, hitY, isArtillery = false) {
    const wall = wallStates[ownerIndex];
    if (!wall || !wall.active) return;
    if (isArtillery) {
        wall.hp = 0;
        showDamageText(hitX, hitY + 40, "DEVOR PORTLADI!", true, false);
        triggerCinematicExplosion(hitX, hitY);
    } else {
        wall.hp = Math.max(0, Number(wall.hp || WALL_HP_MAX) - 1);
        showDamageText(hitX, hitY + 40, `DEVOR -1 (${wall.hp}/5)`, false, true);
        spawnParticles(hitX, hitY, 12, true);
    }
    if (wall.hp <= 0) {
        removeWall(ownerIndex);
    } else {
        setWallState(ownerIndex, true, wall.x, wall.hp);
    }
}'''

# Replace the broken function
content = re.sub(r'function applyWallHit\(ownerIndex, hitX, hitY\) \{.*?\}', apply_wall_fixed, content, count=1, flags=re.DOTALL)

# 2. Remove rotation logic from gameLoop
content = re.sub(r'if \(isArtilleryAiming && myArtilleryCannon\) \{.*?\}', '', content, flags=re.DOTALL)

# 3. Remove rotation logic from startSpearAnimation
content = re.sub(r'if \(playerIndex === 0\) \{.*?window\.enemyArtilleryCannon\.rotation\.z = .*?;.*?\} else \{.*?window\.enemyArtilleryCannon\.rotation\.z = .*?;.*?\}', '', content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Successfully applied fixes.")
