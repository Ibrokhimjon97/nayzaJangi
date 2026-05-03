import sys

file_path = 'public/client.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add fetch logic right after ottomanSpearmanTextures
insert_idx = content.find('const ottomanSpearmanTextures = {')
insert_idx = content.find('};', insert_idx) + 2

custom_models_logic = """

window.customModelsInfo = [];
window.customModelTextures = {};

async function fetchCustomModels() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        window.customModelsInfo = data;
        
        const s1 = document.getElementById('select-char-type');
        const s2 = document.getElementById('select-char-type-options');
        data.forEach(m => {
            if (s1) s1.innerHTML += `<option value="${m.id}">${m.name}</option>`;
            if (s2) s2.innerHTML += `<option value="${m.id}">${m.name}</option>`;
        });
        
        // Ensure values match profile if any
        if (typeof myProfile !== 'undefined' && myProfile && myProfile.charType) {
            if (s1) s1.value = String(myProfile.charType);
            if (s2) s2.value = String(myProfile.charType);
        }
        
        data.forEach(m => {
            window.customModelTextures[m.id] = {
                shieldIdle: loadTexture(m.textures.idle),
                shieldAim: loadTexture(m.textures.aim),
                shieldDuck: loadTexture(m.textures.duck),
                shieldDefend: loadTexture(m.textures.defend),
                shieldHurt: loadTexture(m.textures.idle),
                shieldBreak: loadTexture(m.textures.idle),
                noShieldIdle: loadTexture(m.textures.idle),
                noShieldAim: loadTexture(m.textures.aim),
                noShieldDuck: loadTexture(m.textures.duck),
                noShieldDefend: loadTexture(m.textures.defend),
                noShieldHurt: loadTexture(m.textures.idle),
                celebrate: loadTexture(m.textures.celebrate)
            };
        });
    } catch(e) { console.error('Error loading custom models:', e); }
}
fetchCustomModels();
"""

content = content[:insert_idx] + custom_models_logic + content[insert_idx:]

create_soldier_old = """const normalizedCharType = Number(charType || 0);
    group.userData.charType = normalizedCharType;
    group.userData.isOttomanArcher = normalizedCharType === 2;
    group.userData.isOttomanSpearman = normalizedCharType === 3;
    group.userData.isOttomanUnit = group.userData.isOttomanArcher || group.userData.isOttomanSpearman;"""

create_soldier_new = """const normalizedCharType = (typeof charType === 'string' && charType.startswith('custom_')) ? charType : Number(charType || 0);
    group.userData.charType = normalizedCharType;
    group.userData.isCustomModel = typeof normalizedCharType === 'string' && normalizedCharType.startsWith('custom_');
    group.userData.isOttomanArcher = normalizedCharType === 2;
    group.userData.isOttomanSpearman = normalizedCharType === 3;
    group.userData.isOttomanUnit = group.userData.isOttomanArcher || group.userData.isOttomanSpearman || group.userData.isCustomModel;"""

content = content.replace(create_soldier_old, create_soldier_new)

texture_sel_old = """if (normalizedCharType === 2) selectedTexture = ottomanArcherTextures.shieldIdle;
    if (normalizedCharType === 3) selectedTexture = ottomanSpearmanTextures.shieldIdle;"""

texture_sel_new = """if (normalizedCharType === 2) selectedTexture = ottomanArcherTextures.shieldIdle;
    if (normalizedCharType === 3) selectedTexture = ottomanSpearmanTextures.shieldIdle;
    if (group.userData.isCustomModel && window.customModelTextures[normalizedCharType]) {
        selectedTexture = window.customModelTextures[normalizedCharType].shieldIdle;
    }"""

content = content.replace(texture_sel_old, texture_sel_new)

get_ottoman_tex_old = """function getOttomanTexture(model, state) {
    if (model.userData.isOttomanSpearman) return getOttomanSpearmanTexture(model, state);
    return getOttomanArcherTexture(model, state);
}"""

get_ottoman_tex_new = """function getOttomanTexture(model, state) {
    const charType = String(model.userData.charType);
    if (charType.startsWith('custom_') && window.customModelTextures[charType]) {
        const t = window.customModelTextures[charType];
        const shieldBroken = model.userData.shieldBroken;
        if (shieldBroken) {
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
        }
    }
    if (model.userData.isOttomanSpearman) return getOttomanSpearmanTexture(model, state);
    return getOttomanArcherTexture(model, state);
}"""

content = content.replace(get_ottoman_tex_old, get_ottoman_tex_new)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
