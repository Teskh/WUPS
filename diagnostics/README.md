# WUP Diagnostics

This folder contains diagnostic scripts for validating WUP models against quality standards.

## Available Diagnostics

### BOY Diagnostics (`boy-diagnostics.js`)

Validates BOY (Blind Operation Y-axis) drilling operations with three checks:

1. **Wall Thickness Edge Distance Check**: Verifies that the BOY outer edge is at least 10mm from the outer/inner faces of the wall (Z-axis through-thickness)
2. **Stud Distance Check**: Verifies that the BOY outer edge is at least 10mm from the nearest stud (QS) edge
3. **Diameter Check**: Confirms that the BOY diameter is 30mm (within tolerance)

### Electrical Outlet Diagnostics (`outlet-diagnostics.js`)

Detects legacy electrical outlet cuts that need to be updated to the modern format. Legacy outlets are identified by:

1. **Box Cut**: A closed polygon with exactly 4 corners (5 PP points with first and last matching)
2. **Circular Cuts**: Two MP (Milling Point) circular cuts
3. **Alignment**: The circular cuts are positioned such that their edge (center ± radius) aligns with one of the box corners
4. **Structural Clearance**: Outlet edges keep at least 5mm away from studs, blocking, and plates (alerts when closer)

**Detection Logic:**
- For horizontal outlets: The Y coordinate of the MP minus its radius matches one of the box's Y corners
- For vertical outlets: The X coordinate of the MP minus its radius matches one of the box's X corners

**Features:**
- Automatically detects all legacy outlets in the model
- Provides dimensional information (box size, circle radius)
- Checks structural proximity (alerts below 5mm to framing edges)
- Includes a zoom button to focus on each detected outlet in the 3D view
- Reports orientation (horizontal/vertical) for each outlet

### NR Operations Diagnostics (`nr-diagnostics.js`)

Validates NR (Nail Row) operations with three quality checks:

1. **Control Code Check**: Verifies that the NR control code (gauge parameter) is 10
2. **Structural Member Check**: Confirms that the NR is positioned over a structural member (stud, blocking, or plate) by checking bounding box containment
3. **Edge Distance Check**: Verifies that the NR is at least 10mm from the nearest edge of the structural member it is nailing

**Features:**
- Automatically validates all NR operations in the model
- Identifies the type of structural member (stud, plate, blocking) each NR is associated with
- Reports specific edge distances and identifies which edge is closest
- Provides detailed failure information for non-compliant nail rows

### Plate Mislabel Diagnostics (`plate-mislabel-diagnostics.js`)

Detects misuse of OG/UG components based on the specification:

1. **Single Plate Per Role**: Flags when more than one OG (top plate) or UG (bottom plate) is present in the element
2. **Span Coverage**: Warns when a plate is shorter than 80% of the element length (short plate typically indicates a mislabelled stud/blocking)
3. **Overlapping Plates**: Flags overlapping plates of the same role (multiple plates occupying the same y-plane)

**Features:**
- Works on any parsed model (no UI dependencies)
- Reports per-check pass/fail counts and detailed failure messages
- Compatible with `diagnostic-runner.js` for aggregated execution

### Batch Outlet Modernizer (`batch-outlet-modernizer.html`)

A standalone web application for batch processing WUP files to modernize legacy electrical outlets.

**Features:**
- Process single WUP files or entire directories
- Automatically detects all legacy outlets in each file
- Replaces legacy outlets with modern format using the standard template
- Preserves all routing metadata (tool, face, passes, layer)
- Downloads modified files individually
- Generates detailed processing reports
- Real-time progress tracking
- Summary statistics (files processed, outlets modernized, etc.)

**Usage:**
1. Open `diagnostics/batch-outlet-modernizer.html` in a web browser
2. Select either a single .wup file or a directory containing multiple .wup files
3. Click "Process Files"
4. Review the results and download modified files or the report

**Technical Details:**
- Uses `outlet-diagnostics.js` to detect legacy outlets
- Uses `outlet-modernizer.js` to create modern outlet routings
- Properly maintains WUP file structure and statement ordering
- Handles both horizontal and vertical outlet orientations
- Processes outlets sequentially, re-parsing after each replacement to maintain data integrity
- Uses the same replacement algorithm as the interactive version for consistency

## Usage

### Via UI

1. Load a WUP file in the main application
2. Click the "Run Diagnostics" button in the controls panel
3. The diagnostics panel will open
4. Choose to run all diagnostics or select a specific diagnostic
5. View results in the expandable checklist format
6. Optionally save the report as a text file

### Programmatically

```javascript
// Import the diagnostic runner
import { runDiagnostic, runAllDiagnostics } from './diagnostics/diagnostic-runner.js';

// Assume you have a parsed model
const model = parseWup(wupText);

// Run a specific diagnostic
const boyResults = runDiagnostic('boy', model);
console.log(boyResults.textReport);

// Run all diagnostics
const allResults = runAllDiagnostics(model);
console.log(formatAllDiagnosticsReport(allResults));
```

### Console Usage

After loading a WUP file in the browser, you can run diagnostics from the console:

```javascript
// Run BOY diagnostics
const boyResults = runBoyDiagnostics(window.__lastWupModel.model);
console.log(formatDiagnosticReport(boyResults));

// Run outlet diagnostics
const outletResults = runOutletDiagnostics(window.__lastWupModel.model);
console.log(formatOutletReport(outletResults));

// Run all diagnostics
const allResults = runAllDiagnostics(window.__lastWupModel.model);
console.log(formatAllDiagnosticsReport(allResults));

// Save results to file
saveDiagnosticResults(allResults);
```

## Architecture

### Files

- **`boy-diagnostics.js`**: BOY-specific diagnostic logic
- **`outlet-diagnostics.js`**: Electrical outlet diagnostic logic
- **`outlet-modernizer.js`**: Creates modern outlet routing from template
- **`diagnostic-runner.js`**: Manages and executes all diagnostics
- **`diagnostics-ui.js`**: UI component for interactive diagnostics
- **`diagnostics-styles.css`**: Styling for the diagnostics panel
- **`batch-outlet-modernizer.html`**: Standalone batch processing tool (HTML)
- **`batch-outlet-modernizer.js`**: Batch processing logic
- **`batch-outlet-modernizer.css`**: Styling for batch processor UI
- **`test-batch-modernizer.js`**: Node.js test script for batch modernizer

### Data Structure

Diagnostic results follow this structure:

```javascript
{
  summary: {
    total: number,      // Total number of elements tested
    passed: number,     // Number that passed all checks
    failed: number      // Number that failed any check
  },
  checks: [
    {
      name: string,           // Check name
      description: string,    // Check description
      results: [
        {
          id: string,         // Element identifier
          passed: boolean,    // Did this element pass?
          message: string,    // Human-readable result
          details: object,    // Additional details
          element: object,    // Associated framing element
          boy: object         // BOY operation data
        }
      ]
    }
  ]
}
```

## Adding New Diagnostics

To add a new diagnostic:

1. Create a new file (e.g., `paf-diagnostics.js`)
2. Implement the diagnostic function:
   ```javascript
   export function runPafDiagnostics(model) {
     // Your diagnostic logic
     return {
       summary: { total, passed, failed },
       checks: [...]
     };
   }
   ```
3. Add a formatter function:
   ```javascript
   export function formatPafReport(results) {
     // Format results as text
     return reportString;
   }
   ```
4. Register it in `diagnostic-runner.js`:
   ```javascript
   import { runPafDiagnostics, formatPafReport } from "./paf-diagnostics.js";

   const DIAGNOSTICS = {
     // ... existing diagnostics
     paf: {
       name: "PAF Routings",
       description: "Validates PAF routing operations",
       runner: runPafDiagnostics,
       formatter: formatPafReport
     }
   };
   ```

## BOY Diagnostic Details

### Wall Thickness Edge Distance Check

The outer edge of the BOY operation (considering its radius) must be at least 10mm away from the outer and inner faces of the wall through the Z-axis (wall thickness). This is calculated using the `z` position (through-wall position) and the diameter:

- Distance from outer side = `z - radius`
- Distance from inner side = `wallThickness - z - radius`
- Both must be ≥ 10mm

This check ensures the BOY doesn't break through the wall faces.

### Stud Distance Check

The outer edge of the BOY operation must be at least 10mm away from the nearest stud (QS) edge. This is calculated along the X-axis:

- For each stud, calculate horizontal distance from BOY center to stud edges
- Find the minimum distance to any stud
- Subtract the BOY radius to get clearance: `clearance = distance - radius`
- Clearance must be ≥ 10mm

This check ensures the BOY doesn't weaken studs by drilling too close to their edges.

### Diameter Check

BOY operations should have a diameter of exactly 30mm (with 0.1mm tolerance). This is specified in the third parameter of the BOY command.

## Testing

To test the diagnostics:

**BOY Diagnostics:**
1. Load `example2.wup` which contains BOY operations
2. Run the diagnostics
3. Verify that results are displayed correctly
4. Check that expandable sections work
5. Test the zoom functionality for failed BOY checks

**Outlet Diagnostics:**
1. Load `probeta.wup` which contains legacy outlet cuts
2. Run the outlet diagnostics or all diagnostics
3. Verify that legacy outlets are detected
4. Check the dimensional information is accurate
5. Test the zoom button to focus on detected outlets in the 3D view

**NR Operations Diagnostics:**
1. Load `example.wup` or other files containing NR operations
2. Run the NR diagnostics or all diagnostics
3. Verify that control codes are validated correctly
4. Check that structural member associations are identified
5. Confirm edge distance calculations are accurate

**General:**
1. Test saving the report to a file
2. Verify that the diagnostics panel UI works correctly

## Future Enhancements

Potential additions:
- PAF routing diagnostics (depth, orientation, overlap checks)
- Additional nail row checks (spacing consistency, coverage analysis)
- Structural integrity checks (stud spacing, blocking placement)
- Material usage optimization
- Visual indicators in the 3D view for failed checks
- Export to different formats (JSON, CSV, PDF)
