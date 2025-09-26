// Debug script untuk PDF export
// Jalankan ini di console browser di halaman analytics

console.log('🔧 PDF Export Debug Script Loaded');

// Function untuk debug PDF export
function debugPDFExport() {
    console.log('🔍 Starting PDF export debug...');
    
    // Check if we're on the right page
    console.log('📍 Current URL:', window.location.href);
    console.log('📍 Current path:', window.location.pathname);
    
    if (window.location.pathname !== '/analytics') {
        console.warn('⚠️ Not on analytics page!');
        console.log('💡 Please navigate to /analytics page first');
        return;
    }
    
    // Check if export button exists
    const exportBtn = document.getElementById('export-pdf-btn');
    console.log('🔍 Export button found:', exportBtn);
    
    if (exportBtn) {
        console.log('✅ Export button exists');
        console.log('🔍 Button text:', exportBtn.textContent);
        console.log('🔍 Button classes:', exportBtn.className);
        console.log('🔍 Button disabled:', exportBtn.disabled);
        console.log('🔍 Button visible:', exportBtn.offsetParent !== null);
        
        // Check if button has event listeners
        console.log('🔍 Button onclick:', exportBtn.onclick);
        
        // Try to click the button programmatically
        console.log('🖱️ Attempting to click button programmatically...');
        exportBtn.click();
        
    } else {
        console.error('❌ Export button not found!');
        
        // List all buttons on the page
        console.log('🔍 All buttons on page:');
        const allButtons = document.querySelectorAll('button');
        allButtons.forEach((btn, index) => {
            console.log(`Button ${index}:`, {
                id: btn.id,
                text: btn.textContent.trim(),
                classes: btn.className,
                visible: btn.offsetParent !== null
            });
        });
    }
    
    // Check if forwardTableData exists
    console.log('📊 Checking forwardTableData...');
    if (typeof forwardTableData !== 'undefined') {
        console.log('✅ forwardTableData exists');
        console.log('📊 Data length:', forwardTableData.length);
        console.log('📊 Data:', forwardTableData);
    } else {
        console.error('❌ forwardTableData not defined');
    }
    
    // Check if jsPDF is available
    console.log('📄 Checking jsPDF...');
    if (typeof window.jspdf !== 'undefined') {
        console.log('✅ jsPDF available');
        console.log('📄 jsPDF object:', window.jspdf);
    } else {
        console.error('❌ jsPDF not available');
    }
    
    // Check if moment is available
    console.log('📅 Checking moment...');
    if (typeof moment !== 'undefined') {
        console.log('✅ Moment available');
    } else {
        console.error('❌ Moment not available');
    }
}

// Function untuk test PDF export dengan data dummy
function testPDFWithDummyData() {
    console.log('🧪 Testing PDF export with dummy data...');
    
    // Set dummy data
    window.forwardTableData = [
        {
            problem_id: 1,
            machine: 'Test Machine',
            problem_type: 'Quality',
            flow_type: 'Test Flow',
            timestamps: {
                active_at: '2024-01-01 10:00:00',
                forwarded_at: '2024-01-01 10:05:00',
                received_at: '2024-01-01 10:10:00',
                feedback_resolved_at: '2024-01-01 10:30:00',
                final_resolved_at: '2024-01-01 10:35:00'
            },
            durations_formatted: {
                active_to_forward: '5 menit',
                forward_to_receive: '5 menit',
                receive_to_feedback: '20 menit',
                feedback_to_final: '5 menit',
                total_duration: '35 menit'
            },
            users: {
                forwarded_by: 'Test User 1',
                received_by: 'Test User 2',
                feedback_by: 'Test User 3'
            }
        }
    ];
    
    console.log('✅ Dummy data set');
    console.log('📊 Data:', window.forwardTableData);
    
    // Try to call export function
    if (typeof exportForwardTableToPDF === 'function') {
        console.log('✅ exportForwardTableToPDF function exists');
        console.log('🔄 Calling export function...');
        exportForwardTableToPDF();
    } else {
        console.error('❌ exportForwardTableToPDF function not found');
    }
}

// Function untuk manual PDF export
function manualPDFExport() {
    console.log('🔄 Manual PDF export...');
    
    if (typeof window.jspdf === 'undefined') {
        console.error('❌ jsPDF not available');
        alert('jsPDF library not available');
        return;
    }
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4');
        
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text('Manual PDF Export Test', 20, 20);
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Generated at: ${new Date().toLocaleString()}`, 20, 30);
        
        const fileName = `manual_test_${new Date().getTime()}.pdf`;
        doc.save(fileName);
        
        console.log('✅ Manual PDF export successful:', fileName);
        alert(`PDF exported: ${fileName}`);
        
    } catch (error) {
        console.error('❌ Manual PDF export failed:', error);
        alert('PDF export failed: ' + error.message);
    }
}

// Make functions available globally
window.debugPDFExport = debugPDFExport;
window.testPDFWithDummyData = testPDFWithDummyData;
window.manualPDFExport = manualPDFExport;

console.log('🔧 Debug functions available:');
console.log('  - debugPDFExport() - Debug PDF export functionality');
console.log('  - testPDFWithDummyData() - Test with dummy data');
console.log('  - manualPDFExport() - Manual PDF export test');
