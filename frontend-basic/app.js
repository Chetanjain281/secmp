// Tokenized Funds Marketplace Frontend Application
class MarketplaceApp {
    constructor() {
        this.baseURL = 'http://localhost';
        this.services = {
            auth: 3010,
            user: 3012,
            fund: 3013,
            trading: 3014,
            settlement: 3015,
            blockchain: 3016,
            notification: 3020,
            navOracle: 3021,
            forexOracle: 3022,
            custodyOracle: 3023,
            marketOracle: 3024
        };
        
        this.currentUser = null;
        this.refreshIntervals = {};
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.checkAuthStatus();
        this.loadDashboardData();
    }
    
    setupEventListeners() {
        // Navigation
        document.querySelectorAll('[data-section]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSection(e.target.dataset.section);
            });
        });
        
        // Forms
        document.getElementById('orderForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.placeOrder();
        });
        
        document.getElementById('createFundForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createFund();
        });
        
        document.getElementById('profileForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateProfile();
        });
        
        // Price type change
        document.getElementById('priceType').addEventListener('change', (e) => {
            const limitContainer = document.getElementById('limitPriceContainer');
            limitContainer.style.display = e.target.value === 'limit' ? 'block' : 'none';
        });
    }
    
    // API Helper Methods
    async apiCall(service, endpoint, method = 'GET', data = null) {
        const url = `${this.baseURL}:${this.services[service]}${endpoint}`;
        
        try {
            const config = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            
            if (data) {
                config.body = JSON.stringify(data);
            }
            
            const response = await fetch(url, config);
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.message || 'API call failed');
            }
            
            return result;
        } catch (error) {
            console.error(`API call to ${service}${endpoint} failed:`, error);
            this.showToast(`Error: ${error.message}`, 'error');
            throw error;
        }
    }
    
    // Authentication Methods
    async login() {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        try {
            const result = await this.apiCall('auth', '/api/login', 'POST', { email, password });
            
            this.currentUser = result.user;
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            
            this.updateUIForAuthenticatedUser();
            this.closeModal('loginModal');
            this.showToast('Login successful!', 'success');
            
            // Load user profile
            await this.loadUserProfile();
            
        } catch (error) {
            this.showToast('Login failed: ' + error.message, 'error');
        }
    }
    
    async register() {
        const firstName = document.getElementById('registerFirstName').value;
        const lastName = document.getElementById('registerLastName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const role = document.getElementById('registerRole').value;
        
        try {
            const result = await this.apiCall('auth', '/api/register', 'POST', {
                email, password, firstName, lastName, role
            });
            
            this.showToast('Registration successful! Please login.', 'success');
            this.showLogin();
            
        } catch (error) {
            this.showToast('Registration failed: ' + error.message, 'error');
        }
    }
    
    logout() {
        this.currentUser = null;
        localStorage.removeItem('currentUser');
        this.updateUIForGuestUser();
        this.showSection('dashboard');
        this.showToast('Logged out successfully', 'info');
    }
    
    checkAuthStatus() {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            this.currentUser = JSON.parse(stored);
            this.updateUIForAuthenticatedUser();
            this.loadUserProfile();
        }
    }
    
    updateUIForAuthenticatedUser() {
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('userDropdown').style.display = 'block';
        document.getElementById('userDisplayName').textContent = 
            `${this.currentUser.firstName} ${this.currentUser.lastName}`;
    }
    
    updateUIForGuestUser() {
        document.getElementById('loginBtn').style.display = 'block';
        document.getElementById('userDropdown').style.display = 'none';
    }
    
    // User Profile Methods
    async loadUserProfile() {
        if (!this.currentUser) return;
        
        try {
            const profile = await this.apiCall('user', `/api/profile/${this.currentUser.userId}`);
            
            // Update profile form
            document.getElementById('profileFirstName').value = profile.profile.firstName || '';
            document.getElementById('profileLastName').value = profile.profile.lastName || '';
            document.getElementById('profileEmail').value = profile.email || '';
            document.getElementById('profilePhone').value = profile.profile.phone || '';
            document.getElementById('profileCountry').value = profile.profile.country || '';
            
            // Update suitability status
            this.updateSuitabilityStatus(profile.suitabilityStatus, profile.suitabilityData);
            
        } catch (error) {
            console.error('Failed to load user profile:', error);
        }
    }
    
    async updateProfile() {
        if (!this.currentUser) return;
        
        const profileData = {
            userId: this.currentUser.userId,
            email: this.currentUser.email,
            profile: {
                firstName: document.getElementById('profileFirstName').value,
                lastName: document.getElementById('profileLastName').value,
                phone: document.getElementById('profilePhone').value,
                country: document.getElementById('profileCountry').value
            },
            role: this.currentUser.role
        };
        
        try {
            await this.apiCall('user', '/api/profile', 'POST', profileData);
            this.showToast('Profile updated successfully!', 'success');
        } catch (error) {
            this.showToast('Profile update failed: ' + error.message, 'error');
        }
    }
    
    updateSuitabilityStatus(status, data) {
        const container = document.getElementById('suitabilityStatus');
        
        if (status === 'completed' && data) {
            container.innerHTML = `
                <div class="alert alert-success">
                    <h6>Assessment Completed</h6>
                    <p class="mb-1">Suitability Score: <strong>${data.score}</strong></p>
                    <p class="mb-0">Eligible Fund Types: ${data.eligibleFundTypes.join(', ')}</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="alert alert-warning">
                    <p class="mb-0">Please complete your suitability assessment to access trading.</p>
                </div>
            `;
        }
    }
    
    // Fund Management Methods
    async loadFunds() {
        try {
            const response = await this.apiCall('fund', '/api/funds');
            const funds = response.funds || [];
            
            this.renderFunds(funds);
            this.populateFundDropdowns(funds);
            
        } catch (error) {
            console.error('Failed to load funds:', error);
            document.getElementById('fundsContainer').innerHTML = `
                <div class="col-12 text-center py-5">
                    <p class="text-muted">Failed to load funds</p>
                </div>
            `;
        }
    }
    
    renderFunds(funds) {
        const container = document.getElementById('fundsContainer');
        
        if (funds.length === 0) {
            container.innerHTML = `
                <div class="col-12 text-center py-5">
                    <p class="text-muted">No funds available</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = funds.map(fund => `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card fund-card h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-3">
                            <h5 class="card-title">${fund.fundName}</h5>
                            <span class="fund-type-badge fund-type-${fund.fundType}">${fund.fundType.replace('_', ' ')}</span>
                        </div>
                        <p class="card-text">${fund.description}</p>
                        <div class="row mb-3">
                            <div class="col-6">
                                <small class="text-muted">Current NAV</small>
                                <div class="fw-bold">$${fund.currentNAV?.toFixed(2) || '100.00'}</div>
                            </div>
                            <div class="col-6">
                                <small class="text-muted">Min Investment</small>
                                <div class="fw-bold">$${fund.minimumInvestment?.toLocaleString() || '0'}</div>
                            </div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-6">
                                <small class="text-muted">Target Size</small>
                                <div class="fw-bold">$${fund.targetSize?.toLocaleString() || '0'}</div>
                            </div>
                            <div class="col-6">
                                <small class="text-muted">Management Fee</small>
                                <div class="fw-bold">${fund.managementFee || 0}%</div>
                            </div>
                        </div>
                        <button class="btn btn-primary w-100" onclick="app.investInFund('${fund.fundId}')">
                            View Details
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    populateFundDropdowns(funds) {
        const orderFundSelect = document.getElementById('orderFund');
        orderFundSelect.innerHTML = '<option value="">Select a fund...</option>' +
            funds.map(fund => `<option value="${fund.fundId}">${fund.fundName}</option>`).join('');
    }
    
    async createFund() {
        if (!this.currentUser) return;
        
        const fundData = {
            fundName: document.getElementById('fundName').value,
            fundType: document.getElementById('fundType').value,
            description: document.getElementById('fundDescription').value,
            targetSize: parseInt(document.getElementById('targetSize').value),
            minimumInvestment: parseInt(document.getElementById('minimumInvestment').value),
            managementFee: parseFloat(document.getElementById('managementFee').value),
            manager: this.currentUser.userId,
            currency: 'USD'
        };
        
        try {
            await this.apiCall('fund', '/api/funds', 'POST', fundData);
            this.showToast('Fund created successfully!', 'success');
            this.closeModal('createFundModal');
            document.getElementById('createFundForm').reset();
            await this.loadFunds();
        } catch (error) {
            this.showToast('Fund creation failed: ' + error.message, 'error');
        }
    }
    
    // Trading Methods
    async placeOrder() {
        if (!this.currentUser) {
            this.showToast('Please login to place orders', 'warning');
            return;
        }
        
        const orderData = {
            fundId: document.getElementById('orderFund').value,
            userId: this.currentUser.userId,
            orderType: document.getElementById('orderType').value,
            quantity: parseInt(document.getElementById('orderQuantity').value),
            priceType: document.getElementById('priceType').value
        };
        
        if (orderData.priceType === 'limit') {
            orderData.limitPrice = parseFloat(document.getElementById('limitPrice').value);
        }
        
        try {
            await this.apiCall('trading', '/api/orders', 'POST', orderData);
            this.showToast('Order placed successfully!', 'success');
            document.getElementById('orderForm').reset();
            await this.loadOrderHistory();
        } catch (error) {
            this.showToast('Order placement failed: ' + error.message, 'error');
        }
    }
    
    async loadOrderHistory() {
        if (!this.currentUser) return;
        
        try {
            const response = await this.apiCall('trading', `/api/orders/user/${this.currentUser.userId}`);
            const orders = response.orders || [];
            
            this.renderOrderHistory(orders);
            
        } catch (error) {
            console.error('Failed to load order history:', error);
        }
    }
    
    renderOrderHistory(orders) {
        const container = document.getElementById('orderHistoryTable');
        
        if (orders.length === 0) {
            container.innerHTML = '<div class="text-center py-3"><small class="text-muted">No orders found</small></div>';
            return;
        }
        
        container.innerHTML = `
            <div class="table-responsive">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Fund</th>
                            <th>Type</th>
                            <th>Quantity</th>
                            <th>Price</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${orders.map(order => `
                            <tr>
                                <td>${order.fundId}</td>
                                <td><span class="badge bg-${order.orderType === 'buy' ? 'success' : 'danger'}">${order.orderType}</span></td>
                                <td>${order.quantity}</td>
                                <td>$${order.price?.toFixed(2) || 'Market'}</td>
                                <td><span class="order-status ${order.status}">${order.status}</span></td>
                                <td>${new Date(order.createdAt).toLocaleDateString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    // Dashboard Methods
    async loadDashboardData() {
        this.loadMarketSummary();
        this.loadTopPerformers();
        this.loadHighestVolume();
        this.loadForexRates();
        
        // Set up refresh intervals
        this.setupRefreshIntervals();
    }
    
    async loadMarketSummary() {
        try {
            const response = await this.apiCall('marketOracle', '/api/analytics/market');
            
            document.getElementById('totalMarketCap').textContent = 
                this.formatCurrency(response.summary.totalMarketCap || 0);
            document.getElementById('totalVolume24h').textContent = 
                this.formatCurrency(response.summary.totalVolumeUSD24h || 0);
            document.getElementById('totalFunds').textContent = 
                response.summary.totalFunds || 0;
                
        } catch (error) {
            console.error('Failed to load market summary:', error);
        }
    }
    
    async loadTopPerformers() {
        try {
            const response = await this.apiCall('marketOracle', '/api/analytics/market');
            const performers = response.topGainers || [];
            
            const container = document.getElementById('topPerformersTable');
            container.innerHTML = performers.length > 0 ? `
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Fund</th>
                                <th>Price</th>
                                <th>Change</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${performers.map(fund => `
                                <tr>
                                    <td>${fund.symbol}</td>
                                    <td>$${fund.currentPrice.toFixed(2)}</td>
                                    <td class="price-change positive">+${fund.priceChangePercent24h.toFixed(2)}%</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<div class="text-center py-3"><small class="text-muted">No data available</small></div>';
            
        } catch (error) {
            console.error('Failed to load top performers:', error);
        }
    }
    
    async loadHighestVolume() {
        try {
            const response = await this.apiCall('marketOracle', '/api/analytics/market');
            const volumeData = response.topVolume || [];
            
            const container = document.getElementById('highestVolumeTable');
            container.innerHTML = volumeData.length > 0 ? `
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Fund</th>
                                <th>Price</th>
                                <th>Volume</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${volumeData.map(fund => `
                                <tr>
                                    <td>${fund.symbol}</td>
                                    <td>$${fund.currentPrice.toFixed(2)}</td>
                                    <td>$${this.formatCurrency(fund.volumeUSD24h)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<div class="text-center py-3"><small class="text-muted">No data available</small></div>';
            
        } catch (error) {
            console.error('Failed to load volume data:', error);
        }
    }
    
    async loadForexRates() {
        try {
            const response = await this.apiCall('forexOracle', '/api/rates/latest');
            const rate = response.rates?.find(r => r.pair === 'INR/USD');
            
            if (rate) {
                document.getElementById('inrUsdRate').textContent = `₹${rate.rate.toFixed(2)}`;
            }
            
        } catch (error) {
            console.error('Failed to load forex rates:', error);
        }
    }
    
    // Oracle Data Methods
    async loadOracleData() {
        await Promise.all([
            this.loadNAVOracleData(),
            this.loadForexOracleData(),
            this.loadCustodyOracleData(),
            this.loadMarketOracleData()
        ]);
    }
    
    async loadNAVOracleData() {
        try {
            const response = await this.apiCall('navOracle', '/api/nav/latest');
            const container = document.getElementById('navOracleData');
            
            container.innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator online"></div>
                    <span>NAV Oracle Active</span>
                    <span class="real-time-indicator">LIVE</span>
                </div>
                ${response.navUpdates?.slice(0, 5).map(update => `
                    <div class="data-point">
                        <span class="data-label">${update.fundId}</span>
                        <span class="data-value">$${update.navPerToken.toFixed(2)}</span>
                    </div>
                `).join('') || '<p class="text-muted">No NAV data available</p>'}
            `;
            
        } catch (error) {
            document.getElementById('navOracleData').innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator offline"></div>
                    <span>NAV Oracle Offline</span>
                </div>
            `;
        }
    }
    
    async loadForexOracleData() {
        try {
            const response = await this.apiCall('forexOracle', '/api/rates/latest');
            const container = document.getElementById('forexOracleData');
            
            container.innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator online"></div>
                    <span>Forex Oracle Active</span>
                    <span class="real-time-indicator">LIVE</span>
                </div>
                ${response.rates?.map(rate => `
                    <div class="data-point">
                        <span class="data-label">${rate.pair}</span>
                        <span class="data-value">${rate.rate.toFixed(4)}</span>
                    </div>
                `).join('') || '<p class="text-muted">No forex data available</p>'}
            `;
            
        } catch (error) {
            document.getElementById('forexOracleData').innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator offline"></div>
                    <span>Forex Oracle Offline</span>
                </div>
            `;
        }
    }
    
    async loadCustodyOracleData() {
        try {
            const response = await this.apiCall('custodyOracle', '/api/analytics/custody');
            const container = document.getElementById('custodyOracleData');
            
            container.innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator online"></div>
                    <span>Custody Oracle Active</span>
                    <span class="real-time-indicator">LIVE</span>
                </div>
                <div class="data-point">
                    <span class="data-label">Total Assets</span>
                    <span class="data-value">${response.summary?.totalAssets || 0}</span>
                </div>
                <div class="data-point">
                    <span class="data-label">Total Value</span>
                    <span class="data-value">$${this.formatCurrency(response.summary?.totalValue || 0)}</span>
                </div>
            `;
            
        } catch (error) {
            document.getElementById('custodyOracleData').innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator offline"></div>
                    <span>Custody Oracle Offline</span>
                </div>
            `;
        }
    }
    
    async loadMarketOracleData() {
        try {
            const response = await this.apiCall('marketOracle', '/api/analytics/market');
            const container = document.getElementById('marketOracleData');
            
            container.innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator online"></div>
                    <span>Market Oracle Active</span>
                    <span class="real-time-indicator">LIVE</span>
                </div>
                <div class="data-point">
                    <span class="data-label">Market Cap</span>
                    <span class="data-value">$${this.formatCurrency(response.summary?.totalMarketCap || 0)}</span>
                </div>
                <div class="data-point">
                    <span class="data-label">24h Volume</span>
                    <span class="data-value">$${this.formatCurrency(response.summary?.totalVolumeUSD24h || 0)}</span>
                </div>
            `;
            
        } catch (error) {
            document.getElementById('marketOracleData').innerHTML = `
                <div class="oracle-status">
                    <div class="status-indicator offline"></div>
                    <span>Market Oracle Offline</span>
                </div>
            `;
        }
    }
    
    // Utility Methods
    setupRefreshIntervals() {
        // Refresh dashboard every 30 seconds
        this.refreshIntervals.dashboard = setInterval(() => {
            if (document.getElementById('dashboardSection').style.display !== 'none') {
                this.loadDashboardData();
            }
        }, 30000);
        
        // Refresh oracle data every 10 seconds
        this.refreshIntervals.oracles = setInterval(() => {
            if (document.getElementById('oraclesSection').style.display !== 'none') {
                this.loadOracleData();
            }
        }, 10000);
    }
    
    showSection(sectionName) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.style.display = 'none';
        });
        
        // Show selected section
        const targetSection = document.getElementById(sectionName + 'Section');
        if (targetSection) {
            targetSection.style.display = 'block';
            
            // Load section-specific data
            this.loadSectionData(sectionName);
        }
        
        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`)?.classList.add('active');
    }
    
    async loadSectionData(sectionName) {
        switch (sectionName) {
            case 'funds':
                await this.loadFunds();
                break;
            case 'trading':
                await this.loadFunds();
                await this.loadOrderHistory();
                break;
            case 'portfolio':
                await this.loadPortfolio();
                break;
            case 'profile':
                await this.loadUserProfile();
                break;
            case 'oracles':
                await this.loadOracleData();
                break;
        }
    }
    
    async loadPortfolio() {
        if (!this.currentUser) return;
        
        // Placeholder for portfolio data
        document.getElementById('portfolioValue').textContent = '$0.00';
        document.getElementById('totalInvestments').textContent = '0';
        document.getElementById('portfolioPnL').textContent = '$0.00';
        
        document.getElementById('portfolioHoldings').innerHTML = `
            <div class="text-center py-3">
                <small class="text-muted">No holdings found</small>
            </div>
        `;
    }
    
    formatCurrency(amount) {
        if (amount >= 1000000) {
            return (amount / 1000000).toFixed(1) + 'M';
        } else if (amount >= 1000) {
            return (amount / 1000).toFixed(1) + 'K';
        } else {
            return amount.toFixed(2);
        }
    }
    
    showToast(message, type = 'info') {
        const toast = document.getElementById('notificationToast');
        const toastBody = document.getElementById('toastMessage');
        
        toastBody.textContent = message;
        
        // Remove existing classes and add new ones
        toast.className = `toast bg-${type === 'error' ? 'danger' : type}`;
        
        const bsToast = new bootstrap.Toast(toast);
        bsToast.show();
    }
    
    showLogin() {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
        document.querySelector('#loginModal .modal-title').textContent = 'Login to Marketplace';
        
        const modal = new bootstrap.Modal(document.getElementById('loginModal'));
        modal.show();
    }
    
    showRegister() {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
        document.querySelector('#loginModal .modal-title').textContent = 'Register for Marketplace';
    }
    
    showCreateFund() {
        if (!this.currentUser) {
            this.showToast('Please login to create funds', 'warning');
            return;
        }
        
        const modal = new bootstrap.Modal(document.getElementById('createFundModal'));
        modal.show();
    }
    
    closeModal(modalId) {
        const modal = bootstrap.Modal.getInstance(document.getElementById(modalId));
        if (modal) {
            modal.hide();
        }
    }
    
    investInFund(fundId) {
        if (!this.currentUser) {
            this.showToast('Please login to invest', 'warning');
            return;
        }
        
        // Switch to trading section and pre-select the fund
        this.showSection('trading');
        document.getElementById('orderFund').value = fundId;
        document.getElementById('orderType').value = 'buy';
    }
    
    showSuitabilityAssessment() {
        if (!this.currentUser) {
            this.showToast('Please login to complete assessment', 'warning');
            return;
        }
        
        // Simple suitability assessment
        const assessment = {
            riskTolerance: 'moderate',
            investmentExperience: 'intermediate',
            incomeLevel: '1Cr_plus',
            netWorth: '5Cr_plus',
            investmentHorizon: 'long_term',
            geography: 'india'
        };
        
        this.apiCall('user', `/api/suitability/${this.currentUser.userId}`, 'POST', assessment)
            .then(() => {
                this.showToast('Suitability assessment completed!', 'success');
                this.loadUserProfile();
            })
            .catch(error => {
                this.showToast('Assessment failed: ' + error.message, 'error');
            });
    }
}

// Global functions for HTML onclick handlers
function login() {
    app.login();
}

function register() {
    app.register();
}

function logout() {
    app.logout();
}

function showLogin() {
    app.showLogin();
}

function showRegister() {
    app.showRegister();
}

function showCreateFund() {
    app.showCreateFund();
}

// Initialize the application
const app = new MarketplaceApp();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MarketplaceApp;
}
