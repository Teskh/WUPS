# WUP Diagnostics

This folder contains diagnostic scripts for validating WUP models against quality standards.

## Available Diagnostics

### BOY Diagnostics (`boy-diagnostics.js`)

Validates BOY (Blind Operation Y-axis) drilling operations with four checks:

1. **Direction Check**: Ensures BOY operations face inward toward the element (plate/stud/joist)
2. **Wall Thickness Edge Distance Check**: Verifies that the BOY outer edge is at least 10mm from the outer/inner faces of the wall (Z-axis through-thickness)
3. **Stud Distance Check**: Verifies that the BOY outer edge is at least 10mm from the nearest stud (QS) edge
4. **Diameter Check**: Confirms that the BOY diameter is 30mm (within tolerance)

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
const results = runBoyDiagnostics(window.__lastWupModel.model);
console.log(formatDiagnosticReport(results));

// Run all diagnostics
const allResults = runAllDiagnostics(window.__lastWupModel.model);
console.log(formatAllDiagnosticsReport(allResults));

// Save results to file
saveDiagnosticResults(allResults);
```

## Architecture

### Files

- **`boy-diagnostics.js`**: BOY-specific diagnostic logic
- **`diagnostic-runner.js`**: Manages and executes all diagnostics
- **`diagnostics-ui.js`**: UI component for interactive diagnostics
- **`diagnostics-styles.css`**: Styling for the diagnostics panel

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

### Direction Check

BOY operations should face inward toward the element they're associated with:
- Bottom elements (plates, studs at lower Y positions): Should use +Y direction
- Top elements (plates, studs at higher Y positions): Should use -Y direction

The direction is determined by the sign of the `depth` parameter in the BOY command.

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

1. Load `example2.wup` which contains BOY operations
2. Run the diagnostics
3. Verify that results are displayed correctly
4. Check that expandable sections work
5. Test saving the report

## Future Enhancements

Potential additions:
- PAF routing diagnostics (depth, orientation, overlap checks)
- Nail row diagnostics (spacing, coverage)
- Structural integrity checks (stud spacing, blocking placement)
- Material usage optimization
- Visual indicators in the 3D view for failed checks
- Export to different formats (JSON, CSV, PDF)
