import re

file_path = 'public/client.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update warrior state logic while dragging
old_state_logic = '''        } else if (isDragging && currentTurnIndex === idx) {
            // Dragging
            const dx = dragStart.x - dragCurrent.x;
            const dy = dragCurrent.y - dragStart.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist > 50) targetState = 'aim';
            else if (dist > 10) targetState = 'load';'''

new_state_logic = '''        } else if (isDragging && currentTurnIndex === idx) {
            // Dragging
            const dx = dragStart.x - dragCurrent.x;
            const dy = dragCurrent.y - dragStart.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (isArtilleryAiming) {
                targetState = 'idle';
            } else if (dist > 50) {
                targetState = 'aim';
            } else if (dist > 10) {
                targetState = 'load';
            }'''
content = content.replace(old_state_logic, new_state_logic)

# 2. Update trajectory line start point
old_trajectory_start = '''            let startX = myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60;
            let startY = p1Model.position.y + 270;'''

new_trajectory_start = '''            let startX = myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60;
            let startY = p1Model.position.y + 270;
            
            if (isArtilleryAiming) {
                startX = (myPlayerIndex === 0 ? p1Model.position.x : p2Model.position.x) + (myPlayerIndex === 0 ? 200 : -200);
                startY = (myPlayerIndex === 0 ? p1Model.position.y : p2Model.position.y) + 150;
            }'''
content = content.replace(old_trajectory_start, new_trajectory_start)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Applied animation and trajectory fixes.")
