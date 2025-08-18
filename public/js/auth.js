// Auth JavaScript for Login Page
class AuthManager {
    constructor() {
        this.loginForm = document.getElementById('loginForm');
        this.loginBtn = document.getElementById('loginBtn');
        this.errorMessage = document.getElementById('errorMessage');
        this.errorText = document.getElementById('errorText');
        this.togglePassword = document.getElementById('togglePassword');
        this.connectionIndicator = document.getElementById('connectionIndicator');
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkServerConnection();
        
        // Auto-focus pada username field
        document.getElementById('username').focus();
        
        console.log('🔐 Auth Manager initialized');
    }

    bindEvents() {
        // Form submission
        this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        
        // Password toggle
        this.togglePassword.addEventListener('click', () => this.togglePasswordVisibility());
        
        // Enter key handling
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.loginBtn.disabled) {
                this.handleLogin(e);
            }
        });
        
        // Input events untuk hide error
        document.getElementById('username').addEventListener('input', () => this.hideError());
        document.getElementById('password').addEventListener('input', () => this.hideError());
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        
        // Validasi input
        if (!username || !password) {
            this.showError('Username dan password harus diisi');
            return;
        }
        
        // Set loading state
        this.setLoading(true);
        this.hideError();
        
        try {
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    password: password
                })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                // Login berhasil
                this.showSuccess();
                
                // Redirect ke dashboard dengan token
                setTimeout(() => {
                    window.location.href = `/auth?token=${data.token}`;
                }, 1000);
                
            } else {
                // Login gagal
                this.showError(data.message || 'Username atau password salah');
                this.setLoading(false);
            }
            
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Koneksi ke server gagal. Silakan coba lagi.');
            this.setLoading(false);
        }
    }

    togglePasswordVisibility() {
        const passwordInput = document.getElementById('password');
        const toggleIcon = this.togglePassword.querySelector('i');
        
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            toggleIcon.className = 'fas fa-eye-slash';
        } else {
            passwordInput.type = 'password';
            toggleIcon.className = 'fas fa-eye';
        }
    }

    setLoading(loading) {
        if (loading) {
            this.loginBtn.disabled = true;
            this.loginBtn.classList.add('loading');
            document.querySelector('.btn-text').textContent = 'Signing In...';
        } else {
            this.loginBtn.disabled = false;
            this.loginBtn.classList.remove('loading');
            document.querySelector('.btn-text').textContent = 'Sign In';
        }
    }

    showSuccess() {
        this.loginBtn.classList.add('success');
        document.querySelector('.btn-text').textContent = 'Success!';
        
        // SweetAlert untuk success
        Swal.fire({
            title: 'Login Berhasil!',
            text: 'Mengarahkan ke dashboard...',
            icon: 'success',
            showConfirmButton: false,
            timer: 1500,
            timerProgressBar: true
        });
    }

    showError(message) {
        this.errorText.textContent = message;
        this.errorMessage.style.display = 'flex';
        
        // Shake animation
        this.errorMessage.classList.remove('animate__animated', 'animate__shakeX');
        void this.errorMessage.offsetWidth; // Trigger reflow
        this.errorMessage.classList.add('animate__animated', 'animate__shakeX');
        
        // Focus ke username jika error
        document.getElementById('username').focus();
        document.getElementById('username').select();
    }

    hideError() {
        this.errorMessage.style.display = 'none';
    }

    async checkServerConnection() {
        try {
            const response = await fetch('/health-check', {
                method: 'GET',
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });
            
            if (response.ok) {
                this.updateConnectionStatus(true);
            } else {
                this.updateConnectionStatus(false);
            }
        } catch (error) {
            console.error('Server connection check failed:', error);
            this.updateConnectionStatus(false);
        }
    }

    updateConnectionStatus(connected) {
        if (connected) {
            this.connectionIndicator.className = 'connection-indicator';
            this.connectionIndicator.innerHTML = '<i class="fas fa-wifi"></i><span>Connected to Server</span>';
        } else {
            this.connectionIndicator.className = 'connection-indicator disconnected';
            this.connectionIndicator.innerHTML = '<i class="fas fa-wifi"></i><span>Server Disconnected</span>';
        }
    }
}

// Global functions untuk compatibility
function showSweetAlert(type, title, message, options = {}) {
    const config = {
        title: title,
        text: message,
        icon: type,
        confirmButtonText: 'OK',
        ...options
    };

    // Set colors berdasarkan type
    switch(type) {
        case 'success':
            config.confirmButtonColor = '#27ae60';
            break;
        case 'error':
            config.confirmButtonColor = '#e74c3c';
            break;
        case 'warning':
            config.confirmButtonColor = '#e99612';
            break;
        default:
            config.confirmButtonColor = '#0A2856';
    }

    Swal.fire(config);
}

// Initialize ketika DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const authManager = new AuthManager();
    
    // Check if user sudah login (redirect ke dashboard)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('logout') === 'success') {
        showSweetAlert('success', 'Logged Out', 'You have been successfully logged out.');
    }
});