
const scope = `${input.sqft} sq ft (${result.squares.toFixed(2)} roofing squares).

Material allowance: ${result.materialSquares.toFixed(2)} squares, including ${input.waste}% waste.

ROOFING PROJECT COST BREAKDOWN
Materials: ${money(result.materialCents)}
Labor: ${money(result.laborCents)}
Permits: ${money(input.permits * 100)}
Other costs: ${money(input.other * 100)}
Estimated job cost: ${money(result.cost)}
Estimated profit: ${money(result.profit)}

${category} roofing work; final scope and measurements subject to inspection.`;
