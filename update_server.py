import sys

file_path = 'server.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update fields list in upload.fields for create/update
old_fields = '''{ name: 'shieldHurt', maxCount: 1 },
    { name: 'shieldBreak', maxCount: 1 },
    { name: 'noShieldIdle', maxCount: 1 },
    { name: 'noShieldAim', maxCount: 1 },
    { name: 'noShieldDuck', maxCount: 1 },
    { name: 'noShieldDefend', maxCount: 1 },
    { name: 'noShieldHurt', maxCount: 1 },
    { name: 'celebrate', maxCount: 1 },'''

new_fields = '''{ name: 'shieldHurt', maxCount: 1 },
    { name: 'shieldBreak', maxCount: 1 },
    { name: 'shieldAfterShot', maxCount: 1 },
    { name: 'noShieldIdle', maxCount: 1 },
    { name: 'noShieldAim', maxCount: 1 },
    { name: 'noShieldDuck', maxCount: 1 },
    { name: 'noShieldDefend', maxCount: 1 },
    { name: 'noShieldHurt', maxCount: 1 },
    { name: 'noShieldAfterShot', maxCount: 1 },
    { name: 'celebrate', maxCount: 1 },'''

content = content.replace(old_fields, new_fields)

# Update fileNames array in update
old_filenames = "const fileNames = ['shieldIdle', 'shieldAim', 'shieldDuck', 'shieldDefend', 'shieldHurt', 'shieldBreak', 'noShieldIdle', 'noShieldAim', 'noShieldDuck', 'noShieldDefend', 'noShieldHurt', 'celebrate'];"
new_filenames = "const fileNames = ['shieldIdle', 'shieldAim', 'shieldDuck', 'shieldDefend', 'shieldHurt', 'shieldBreak', 'shieldAfterShot', 'noShieldIdle', 'noShieldAim', 'noShieldDuck', 'noShieldDefend', 'noShieldHurt', 'noShieldAfterShot', 'celebrate'];"

content = content.replace(old_filenames, new_filenames)

# Update weaponType for update
old_update_settings = '''if (req.body.offsetX !== undefined) oldModel.settings.offsetX = Number(req.body.offsetX);'''
new_update_settings = '''if (req.body.offsetX !== undefined) oldModel.settings.offsetX = Number(req.body.offsetX);
        if (req.body.weaponType !== undefined) oldModel.weaponType = req.body.weaponType;'''
content = content.replace(old_update_settings, new_update_settings)

# Update create required fields validation
old_validation = '''if (!files.shieldIdle || !files.shieldAim || !files.shieldDuck || !files.shieldDefend || !files.shieldHurt || !files.shieldBreak || !files.noShieldIdle || !files.noShieldAim || !files.noShieldDuck || !files.noShieldDefend || !files.noShieldHurt) {'''
new_validation = '''if (!files.shieldIdle || !files.shieldAim || !files.shieldDuck || !files.shieldDefend || !files.shieldHurt || !files.shieldBreak || !files.noShieldIdle || !files.noShieldAim || !files.noShieldDuck || !files.noShieldDefend || !files.noShieldHurt || !files.shieldAfterShot || !files.noShieldAfterShot) {'''
content = content.replace(old_validation, new_validation)

# Update newModel generation
old_newModel = '''                noShieldHurt: 'custom_models/' + files.noShieldHurt[0].filename,
                celebrate: files.celebrate ? 'custom_models/' + files.celebrate[0].filename : 'custom_models/' + files.shieldIdle[0].filename
            },
            bgMusic: files.bgMusic ? 'custom_models/' + files.bgMusic[0].filename : null,
            settings: {'''

new_newModel = '''                noShieldHurt: 'custom_models/' + files.noShieldHurt[0].filename,
                shieldAfterShot: 'custom_models/' + files.shieldAfterShot[0].filename,
                noShieldAfterShot: 'custom_models/' + files.noShieldAfterShot[0].filename,
                celebrate: files.celebrate ? 'custom_models/' + files.celebrate[0].filename : 'custom_models/' + files.shieldIdle[0].filename
            },
            weaponType: req.body.weaponType || 'spear',
            bgMusic: files.bgMusic ? 'custom_models/' + files.bgMusic[0].filename : null,
            settings: {'''
content = content.replace(old_newModel, new_newModel)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('server.js updated!')
