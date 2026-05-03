import sys

file_path = 'public/client.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update custom model texture mapping
old_textures = '''                shieldBreak: loadTexture(m.textures.shieldBreak || m.textures.noShieldIdle),
                noShieldIdle: loadTexture(m.textures.noShieldIdle),
                noShieldAim: loadTexture(m.textures.noShieldAim),
                noShieldDuck: loadTexture(m.textures.noShieldDuck),
                noShieldDefend: loadTexture(m.textures.noShieldDefend),
                noShieldHurt: loadTexture(m.textures.noShieldHurt || m.textures.noShieldIdle),
                celebrate: loadTexture(m.textures.celebrate || m.textures.shieldIdle),'''

new_textures = '''                shieldBreak: loadTexture(m.textures.shieldBreak || m.textures.noShieldIdle),
                shieldAfterShot: loadTexture(m.textures.shieldAfterShot || m.textures.shieldIdle),
                noShieldIdle: loadTexture(m.textures.noShieldIdle),
                noShieldAim: loadTexture(m.textures.noShieldAim),
                noShieldDuck: loadTexture(m.textures.noShieldDuck),
                noShieldDefend: loadTexture(m.textures.noShieldDefend),
                noShieldHurt: loadTexture(m.textures.noShieldHurt || m.textures.noShieldIdle),
                noShieldAfterShot: loadTexture(m.textures.noShieldAfterShot || m.textures.noShieldIdle),
                celebrate: loadTexture(m.textures.celebrate || m.textures.shieldIdle),'''

content = content.replace(old_textures, new_textures)

# Update getOttomanTexture
old_get_texture = '''        if (shieldBroken) {
            if (state === 'duck') return t.noShieldDuck;
            if (state === 'aim') return t.noShieldAim;
            if (state === 'defend') return t.noShieldDefend;
            if (state === 'hurt') return t.noShieldHurt;
            if (state === 'celebrate') return t.celebrate;
            return t.noShieldIdle;
        } else {
            if (state === 'duck') return t.shieldDuck;
            if (state === 'aim') return t.shieldAim;
            if (state === 'defend') return t.shieldDefend;
            if (state === 'break') return t.shieldBreak;
            if (state === 'hurt') return t.shieldHurt;
            if (state === 'celebrate') return t.celebrate;
            return t.shieldIdle;
        }'''

new_get_texture = '''        if (shieldBroken) {
            if (state === 'duck') return t.noShieldDuck;
            if (state === 'aim') return t.noShieldAim;
            if (state === 'defend') return t.noShieldDefend;
            if (state === 'hurt') return t.noShieldHurt;
            if (state === 'afterShot') return t.noShieldAfterShot;
            if (state === 'celebrate') return t.celebrate;
            return t.noShieldIdle;
        } else {
            if (state === 'duck') return t.shieldDuck;
            if (state === 'aim') return t.shieldAim;
            if (state === 'defend') return t.shieldDefend;
            if (state === 'break') return t.shieldBreak;
            if (state === 'hurt') return t.shieldHurt;
            if (state === 'afterShot') return t.shieldAfterShot;
            if (state === 'celebrate') return t.celebrate;
            return t.shieldIdle;
        }'''

content = content.replace(old_get_texture, new_get_texture)

# Update startSpearAnimation logic for weapon type
old_spear_throw = '''    const isSpearmanThrow = !!thrower?.userData?.isOttomanSpearman;
    applySpearVisualStyle(isSpearmanThrow);
    const spearScale = isSpearmanThrow ? 1.9 : 1;'''

new_spear_throw = '''    let isSpearmanThrow = !!thrower?.userData?.isOttomanSpearman;
    if (thrower?.userData?.isCustomModel) {
        const cModel = window.customModelsInfo && window.customModelsInfo.find(m => m.id == thrower.userData.charType);
        if (cModel && cModel.weaponType === 'spear') {
            isSpearmanThrow = true;
        }
    }
    applySpearVisualStyle(isSpearmanThrow);
    const spearScale = isSpearmanThrow ? 1.9 : 1;'''

content = content.replace(old_spear_throw, new_spear_throw)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('client.js textures and spear visual updated!')
