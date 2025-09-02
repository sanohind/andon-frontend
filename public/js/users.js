document.addEventListener('DOMContentLoaded', () => {
    const roleSelect = document.getElementById('roleSelect');
    const lineNumberInput = document.getElementById('lineNumberInput');
    const addUserForm = document.getElementById('addUserForm');
    const userTableBody = document.querySelector('#userTable tbody');

    roleSelect.addEventListener('change', () => {
        lineNumberInput.style.display = (roleSelect.value === 'leader') ? 'block' : 'none';
        lineNumberInput.required = (roleSelect.value === 'leader');
    });

    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(addUserForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Gagal menambah user.');

            alert('User berhasil ditambahkan!');
            
            const newRow = userTableBody.insertRow();
            newRow.innerHTML = `
                <td>${result.name}</td>
                <td>${result.username}</td>
                <td>${result.role}</td>
                <td>${result.line_number || 'N/A'}</td>
            `;
            addUserForm.reset();
            lineNumberInput.style.display = 'none';
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    });
});