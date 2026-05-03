import sys

with open('public/client.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_block = '''socket.on('hitRegistered', (data) => {
    const { targetIndex, damage, newHealth, newShield, hitX, hitY, isShieldHit, hitAngle, shieldActiveBlock, shieldlessDefense, shieldBroke, hitZone, duckDodged } = data;
    const targetModel = targetIndex === 0 ? p1Model : p2Model;

    if (spear && spear.playerIndex !== myPlayerIndex) {
        hideFlyingSpear();
        if (spear.isArtillery) {
            triggerCinematicExplosion(hitX, hitY);
            showDamageText(hitX, hitY + 80, `-${damage}`, false, true);
            if (damage > 0) knockDownModel(targetModel);
        } else {
            flashHit(targetModel);
            if (duckDodged) {
                showDamageText(hitX, hitY + 80, "BOSHNI EGIB QUTULDI!", false, true);
            } else if (isShieldHit) {
                spawnParticles(hitX, hitY, 10, true);
                const msg = shieldActiveBlock ? "QALQON, BARAKALLA!" : `QALQONGA TEGDI! -${damage}`;
                showDamageText(hitX, hitY + 80, msg, false, true);
                playSfx(shieldActiveBlock ? 'shieldActive' : 'shieldPassive');
            } else {
                let isCrit = damage >= 40;
                spawnParticles(hitX, hitY, isCrit ? 40 : 20);
                if (hitZone === 'head') playSfx('headHit');
                else if (hitZone === 'leg') playSfx('legHit');
                else playSfx('ground', 0.9);
                let msg = "-" + damage;
                if (isCrit) msg = "BOSHGA! " + msg;
                if (shieldlessDefense) msg = "HIMOYA! " + msg;
                showDamageText(hitX, hitY + 80, msg, isCrit);
                if (damage > 0) knockDownModel(targetModel);
            }
        }
    }

    if (targetIndex === myPlayerIndex) {
        myHealth = newHealth; myShield = newShield;
    } else {
        enemyHealth = newHealth; enemyShield = newShield;
    }
    updateShieldUI();
    if ((shieldBroke || newShield <= 0) && !targetModel.userData.shieldBroken) breakShield(targetModel);
    updateHealthUI();
});'''

with open('public/client.js', 'w', encoding='utf-8') as f:
    f.write(''.join(lines[:3535]) + new_block + '\n' + ''.join(lines[3578:]))
print('Done!')
