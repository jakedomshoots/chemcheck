import React, { useState, useMemo } from 'react';
import {
  Search,
  AlertTriangle,
  Droplets,
  Wrench,
  CloudRain,
  ChevronDown,
  ChevronUp,
  Zap,
  ThermometerSun,
  Bug,
  Leaf,
  Shield,
  AlertCircle,
  CheckCircle,
  Info,
  Sparkles,
  CircuitBoard,
  Gauge,
  X
} from 'lucide-react';
import { Card } from '@/components/ui/card';

// ============================================
// POOL SCHOOL DATA - Florida-Specific Content
// ============================================

const POOL_SCHOOL_DATA = {
  categories: [
    {
      id: 'troubleshooting',
      title: "What's Wrong?",
      icon: 'AlertTriangle',
      description: 'Diagnose and fix common water problems',
      gradient: 'from-red-500 via-rose-500 to-pink-500',
      bgGlow: 'bg-red-500/20',
      topics: [
        {
          id: 'green-water',
          title: 'Green Water (Algae)',
          tags: ['algae', 'green', 'swamp', 'bloom'],
          severity: 'high',
          content: {
            summary: "Your pool turned into a swamp. Here's how to fix it fast.",
            floridaNote: "FL sun burns through chlorine FAST. If your CYA is low, algae wins every time.",
            sections: [
              {
                title: 'Green Algae (Most Common)',
                steps: [
                  'Test your **CYA level** first. Below 30? That\'s your problem.',
                  'Brush the walls and floor - get that algae floating.',
                  '**Triple shock** the pool (3 lbs per 10,000 gal).',
                  'Run the pump **24/7** until clear.',
                  'Backwash filter every 8-12 hours.',
                  'Vacuum to WASTE once dead algae settles.'
                ]
              },
              {
                title: 'Mustard Algae (Yellow/Brown)',
                steps: [
                  'This stuff is stubborn and chlorine-resistant.',
                  'Brush EVERYTHING - it hides in crevices.',
                  'Use **Mustard Algae treatment** (Yellow Out, etc.).',
                  'Shock to 30 ppm chlorine.',
                  'Wash all pool toys, floats, and swimsuits - it spreads!'
                ]
              },
              {
                title: 'Black Algae',
                warning: 'This is the worst. It has roots in the plaster.',
                steps: [
                  'Wire brush each spot individually.',
                  'Apply **granular chlorine directly** to spots.',
                  'Use **Black Algae killer** (copper-based).',
                  'May need to drain and acid wash if severe.',
                  'Check for cracks in plaster - that\'s where it lives.'
                ]
              }
            ]
          }
        },
        {
          id: 'cloudy-water',
          title: 'Cloudy Water',
          tags: ['cloudy', 'milky', 'hazy', 'murky', 'white'],
          severity: 'medium',
          content: {
            summary: "Can't see the bottom? Let's figure out why.",
            floridaNote: "After a FL thunderstorm, expect cloudy water. Rain dumps debris and dilutes chemicals.",
            sections: [
              {
                title: 'Chemical Causes',
                steps: [
                  'Test **pH** - high pH (above 7.8) causes cloudiness.',
                  'Check **chlorine** - low FC lets bacteria grow.',
                  'Test **alkalinity** - high TA makes water hazy.',
                  'Add **clarifier** to clump particles for filtering.'
                ]
              },
              {
                title: 'Filtration Causes',
                steps: [
                  'Check filter pressure - high = dirty filter.',
                  'Backwash or clean cartridges.',
                  'Run pump longer (FL heat = more filtering needed).',
                  'Check for channeling in sand filters.',
                  'Inspect DE grids for tears.'
                ]
              },
              {
                title: 'After Heavy Rain',
                steps: [
                  'Test and balance ALL chemicals.',
                  'Shock the pool.',
                  'Run pump 24 hours.',
                  'Skim debris constantly.',
                  'Add clarifier if needed.'
                ]
              }
            ]
          }
        },
        {
          id: 'staining',
          title: 'Staining (Purple/Brown/Green)',
          tags: ['stain', 'purple', 'brown', 'metal', 'iron', 'copper', 'well water'],
          severity: 'medium',
          content: {
            summary: "Ugly stains on your plaster? Usually metals from FL well water.",
            floridaNote: "Florida well water is LOADED with iron and copper. Always use a hose filter when adding water.",
            sections: [
              {
                title: 'Identify the Stain',
                steps: [
                  '**Brown/Red** = Iron (most common in FL)',
                  '**Blue/Green** = Copper (from heaters or algaecides)',
                  '**Purple/Black** = Manganese or copper cyanurate',
                  '**Green on walls** = Could be algae OR copper'
                ]
              },
              {
                title: 'Treatment',
                steps: [
                  'Add **metal sequestrant** (Jack\'s Magic, etc.).',
                  'Keep pH between 7.2-7.4 (metals drop out at high pH).',
                  'Run filter continuously.',
                  'For stubborn stains: vitamin C tablet test.',
                  'If vitamin C removes it = metal stain.',
                  'May need to drain and acid wash for severe cases.'
                ]
              },
              {
                title: 'Prevention',
                steps: [
                  'Use a **hose filter** when filling.',
                  'Add sequestrant monthly if on well water.',
                  'Never shock with metals in water.',
                  'Test source water before adding.'
                ]
              }
            ]
          }
        },
        {
          id: 'chlorine-lock',
          title: 'Chlorine Lock (High CYA)',
          tags: ['cya', 'stabilizer', 'cyanuric', 'chlorine lock', 'no chlorine reading'],
          severity: 'high',
          content: {
            summary: "Adding chlorine but getting no reading? Your CYA is probably through the roof.",
            floridaNote: "This is THE most common FL problem. Stabilized chlorine (tablets) adds CYA every time. FL sun makes you use more tablets = CYA builds up fast.",
            sections: [
              {
                title: 'Understanding the Problem',
                steps: [
                  'CYA protects chlorine from UV, but too much TRAPS it.',
                  'Above 80 ppm, chlorine becomes ineffective.',
                  'Above 100 ppm, you\'re basically swimming in a swamp.',
                  'Every 10 ppm CYA = need higher FC to sanitize.'
                ]
              },
              {
                title: 'The Fix (Bad News)',
                warning: 'There is NO chemical to remove CYA. You must drain water.',
                steps: [
                  'Test CYA level accurately.',
                  'Calculate how much to drain (usually 1/3 to 1/2).',
                  'Drain and refill with fresh water.',
                  'Rebalance all chemicals.',
                  'Switch to **liquid chlorine** to prevent buildup.'
                ]
              },
              {
                title: 'Prevention',
                steps: [
                  'Use **liquid chlorine** for daily sanitizing.',
                  'Use tablets only for vacation/backup.',
                  'Test CYA monthly.',
                  'Keep CYA between 30-50 ppm.',
                  'Partial drain annually if using tablets.'
                ]
              }
            ]
          }
        }
      ]
    },
    {
      id: 'equipment',
      title: 'Equipment Quick-Fixes',
      icon: 'Wrench',
      description: 'Get it running again without a service call',
      gradient: 'from-blue-500 via-indigo-500 to-violet-500',
      bgGlow: 'bg-blue-500/20',
      topics: [
        {
          id: 'pump-issues',
          title: 'Pump Problems',
          tags: ['pump', 'motor', 'humming', 'prime', 'not running', 'air'],
          severity: 'high',
          content: {
            summary: "Pump acting up? Most fixes take 5 minutes.",
            floridaNote: "FL humidity kills pump seals faster. Check that lid o-ring FIRST - it's almost always the problem.",
            sections: [
              {
                title: 'Pump Humming But Not Starting',
                steps: [
                  'Turn it OFF immediately (motor will burn out).',
                  'Check the **capacitor** - look for bulging or leaking.',
                  'Try spinning impeller by hand (might be stuck).',
                  'Check for debris jamming the impeller.',
                  'If motor is hot, let it cool 30 min and retry.',
                  'Capacitor replacement = $20 fix vs $400 motor.'
                ]
              },
              {
                title: 'Pump Losing Prime',
                warning: 'Running dry will destroy the seal in minutes.',
                steps: [
                  '**Check lid o-ring** - #1 cause. Replace if flat/cracked.',
                  'Lube o-ring with silicone (not petroleum!).',
                  'Check pump drain plugs are tight.',
                  'Inspect suction lines for air leaks.',
                  'Check water level - skimmer sucking air?',
                  'Inspect valve stems and unions.'
                ]
              },
              {
                title: 'Pump Running But No Flow',
                steps: [
                  'Check skimmer and pump baskets (clogged?).',
                  'Inspect impeller for debris.',
                  'Check for closed valves.',
                  'Filter might be completely clogged.',
                  'Air lock - open air relief on filter.'
                ]
              }
            ]
          }
        },
        {
          id: 'filter-issues',
          title: 'Filter Problems',
          tags: ['filter', 'pressure', 'backwash', 'de', 'cartridge', 'sand'],
          severity: 'medium',
          content: {
            summary: "Pressure gauge tells you everything. Learn to read it.",
            floridaNote: "FL pollen season (Feb-May) clogs filters FAST. Plan on cleaning twice as often.",
            sections: [
              {
                title: 'High Pressure (10+ psi above clean)',
                steps: [
                  'Filter is dirty - time to clean.',
                  '**Sand**: Backwash until water runs clear.',
                  '**DE**: Backwash and add fresh DE.',
                  '**Cartridge**: Remove and hose off.',
                  'If pressure stays high after cleaning = problem.',
                  'Check for clogged return lines.'
                ]
              },
              {
                title: 'Low Pressure',
                steps: [
                  'Check pump basket - clogged?',
                  'Check skimmer basket.',
                  'Look for suction-side blockage.',
                  'Pump might be losing prime.',
                  'Impeller could be clogged.',
                  'Check water level in pool.'
                ]
              },
              {
                title: 'DE Powder in Pool',
                steps: [
                  'Grids are torn - need replacement.',
                  'Manifold might be cracked.',
                  'Check standpipe o-ring.',
                  'Backwash valve might be leaking.',
                  'Don\'t ignore - DE will clog plumbing.'
                ]
              }
            ]
          }
        },
        {
          id: 'salt-cell',
          title: 'Salt Cell Issues',
          tags: ['salt', 'cell', 'chlorinator', 'scale', 'no chlorine', 'salt system'],
          severity: 'medium',
          content: {
            summary: "Salt cell not making chlorine? Usually scale buildup.",
            floridaNote: "FL hard water + high temps = calcium scale city. Clean cells every 3 months minimum.",
            sections: [
              {
                title: 'No Chlorine Production',
                steps: [
                  'Check salt level (should be 2700-3400 ppm).',
                  'Inspect cell for **white scale buildup**.',
                  'Check flow sensor - might be dirty.',
                  'Verify cell is getting power.',
                  'Check for error codes on control box.',
                  'Cell might be at end of life (3-5 years typical).'
                ]
              },
              {
                title: 'Cleaning the Cell',
                warning: 'Always wear gloves and eye protection with acid.',
                steps: [
                  'Turn off system and remove cell.',
                  'Mix 4:1 water to **muriatic acid**.',
                  'Soak cell 5-10 minutes (watch it fizz).',
                  'Rinse thoroughly with hose.',
                  'Reinstall and check production.',
                  'Don\'t over-clean - shortens cell life.'
                ]
              },
              {
                title: 'Extending Cell Life',
                steps: [
                  'Keep pH between 7.2-7.6.',
                  'Maintain proper salt level.',
                  'Clean cell before scale gets thick.',
                  'Run pump long enough for production.',
                  'Consider a zinc anode to reduce scale.'
                ]
              }
            ]
          }
        }
      ]
    },
    {
      id: 'florida-factors',
      title: 'Florida Factors',
      icon: 'ThermometerSun',
      description: 'Dealing with our unique climate challenges',
      gradient: 'from-orange-500 via-amber-500 to-yellow-500',
      bgGlow: 'bg-orange-500/20',
      topics: [
        {
          id: 'uv-chlorine',
          title: 'UV & Chlorine Burnout',
          tags: ['uv', 'sun', 'chlorine', 'burnout', 'stabilizer', 'cya'],
          severity: 'medium',
          content: {
            summary: "FL sun eats chlorine for breakfast. Here's how to fight back.",
            floridaNote: "Unprotected chlorine loses 90% in 2 hours of FL sun. CYA is not optional here.",
            sections: [
              {
                title: 'The Science (Simple Version)',
                steps: [
                  'UV light destroys chlorine molecules.',
                  '**CYA (stabilizer)** acts like sunscreen for chlorine.',
                  'Without CYA, you\'re throwing money away.',
                  'With too much CYA, chlorine can\'t work.',
                  'Sweet spot: **30-50 ppm CYA**.'
                ]
              },
              {
                title: 'Best Practices',
                steps: [
                  'Test CYA monthly.',
                  'Use **liquid chlorine** + separate stabilizer.',
                  'Or use tablets sparingly.',
                  'Shock at dusk (not morning!).',
                  'Consider a pool cover for unused pools.'
                ]
              }
            ]
          }
        },
        {
          id: 'rain-storms',
          title: 'After Heavy Rain',
          tags: ['rain', 'storm', 'thunder', 'dilution', 'overflow'],
          severity: 'medium',
          content: {
            summary: "3 inches of rain just fell. Now what?",
            floridaNote: "Summer afternoon storms are daily. Have a post-rain routine ready.",
            sections: [
              {
                title: 'Immediate Actions',
                steps: [
                  'Lower water level if overflowing.',
                  'Remove debris (leaves, branches).',
                  'Empty skimmer and pump baskets.',
                  'Check equipment for damage.'
                ]
              },
              {
                title: 'Chemical Rebalancing',
                steps: [
                  'Rain is acidic - **pH will drop**.',
                  'Rain dilutes everything - test ALL levels.',
                  'Add chlorine (rain brings contaminants).',
                  'Adjust pH up (usually needs soda ash).',
                  'Check alkalinity.',
                  'Run pump extra hours.'
                ]
              },
              {
                title: 'After Major Storms',
                steps: [
                  'Shock the pool.',
                  'Add algaecide as prevention.',
                  'Run pump 24 hours.',
                  'Brush walls and floor.',
                  'Vacuum debris to waste if heavy.'
                ]
              }
            ]
          }
        },
        {
          id: 'pollen-phosphates',
          title: 'Pollen & Phosphates',
          tags: ['pollen', 'phosphate', 'oak', 'yellow', 'fertilizer', 'algae food'],
          severity: 'low',
          content: {
            summary: "That yellow film isn't mustard algae - it's oak pollen.",
            floridaNote: "Feb-May is pollen hell. Oak pollen looks exactly like mustard algae but skims right off.",
            sections: [
              {
                title: 'Pollen vs Algae',
                steps: [
                  'Pollen floats and skims off easily.',
                  'Algae clings to walls and brushes off.',
                  'Pollen doesn\'t affect chlorine readings.',
                  'When in doubt, brush it - algae smears, pollen disperses.'
                ]
              },
              {
                title: 'Dealing with Pollen',
                steps: [
                  'Skim frequently (2-3x daily during peak).',
                  'Run pump longer to filter it out.',
                  'Use a fine-mesh skimmer sock.',
                  'Clarifier helps clump it for filtering.',
                  'Don\'t waste money shocking for pollen.'
                ]
              },
              {
                title: 'Phosphate Control',
                steps: [
                  'Phosphates = algae food (from fertilizer runoff).',
                  'Test if you have recurring algae problems.',
                  'Use **phosphate remover** if above 500 ppb.',
                  'Keep landscaping fertilizer away from pool.',
                  'Rinse off before swimming (sunscreen has phosphates).'
                ]
              }
            ]
          }
        },
        {
          id: 'bugs-pests',
          title: 'Bugs & Pests',
          tags: ['bugs', 'love bugs', 'beetles', 'frogs', 'bees', 'wasps'],
          severity: 'low',
          content: {
            summary: "Florida wildlife loves your pool too. Here's how to deal.",
            floridaNote: "Love bug season (May & Sept) will coat your pool. Water beetles are harmless but gross.",
            sections: [
              {
                title: 'Love Bugs',
                steps: [
                  'They\'re attracted to pool chemicals (ironic).',
                  'Skim constantly during season.',
                  'They don\'t affect water chemistry.',
                  'Run skimmer more frequently.',
                  'Consider a pool cover during peak times.'
                ]
              },
              {
                title: 'Water Beetles & Bugs',
                steps: [
                  'Most are harmless - just gross.',
                  'Backswimmers can bite - remove them.',
                  'Shock treatment drives most bugs away.',
                  'Algae attracts bugs - keep pool clean.',
                  'Turn off pool lights at night (attracts them).'
                ]
              },
              {
                title: 'Frogs & Critters',
                steps: [
                  'Install a **Frog Log** escape ramp.',
                  'Check skimmer baskets daily.',
                  'Frogs = your pool has bugs (fix that first).',
                  'Motion-activated sprinklers deter larger animals.'
                ]
              }
            ]
          }
        }
      ]
    },
    {
      id: 'disaster-prep',
      title: 'Hurricane Prep',
      icon: 'CloudRain',
      description: 'Protect your pool before and after storms',
      gradient: 'from-slate-600 via-slate-500 to-zinc-500',
      bgGlow: 'bg-slate-500/20',
      topics: [
        {
          id: 'before-hurricane',
          title: 'Before the Storm',
          tags: ['hurricane', 'storm', 'prep', 'preparation', 'tropical'],
          severity: 'high',
          content: {
            summary: "Hurricane coming? Here's your pool prep checklist.",
            floridaNote: "DO NOT drain your pool. The water weight keeps it in the ground. Empty pools pop out.",
            sections: [
              {
                title: 'Equipment Protection',
                warning: 'Turn off ALL breakers to pool equipment before the storm.',
                steps: [
                  '**Turn off breakers** to pump, heater, salt system.',
                  'Remove pump lid and store inside.',
                  'Bag and protect the pump motor if flooding expected.',
                  'Remove salt cell and store inside.',
                  'Disconnect and store automation controllers.',
                  'Take photos of equipment for insurance.'
                ]
              },
              {
                title: 'Pool Preparation',
                steps: [
                  '**DO NOT DRAIN** - water keeps pool in ground.',
                  'Lower water 1-2 feet (not more).',
                  '**Super-chlorinate** to 10+ ppm.',
                  'Remove all loose items (floats, furniture, toys).',
                  'Throw patio furniture IN the pool (protects it).',
                  'Trim nearby trees if time allows.'
                ]
              },
              {
                title: 'Screen Enclosure',
                steps: [
                  'Open doors/panels if possible (reduces wind load).',
                  'Remove any loose screen panels.',
                  'Document condition with photos.',
                  'Accept that screens may not survive Cat 3+.'
                ]
              }
            ]
          }
        },
        {
          id: 'after-hurricane',
          title: 'After the Storm',
          tags: ['hurricane', 'after', 'cleanup', 'recovery', 'debris'],
          severity: 'high',
          content: {
            summary: "Storm passed. Here's how to get your pool back.",
            floridaNote: "Don't rush to turn equipment on. Check for damage first or you'll make it worse.",
            sections: [
              {
                title: 'Safety First',
                warning: 'Check for downed power lines before approaching pool area.',
                steps: [
                  'Look for downed power lines - stay away.',
                  'Check for structural damage to deck/enclosure.',
                  'Watch for debris with nails/sharp objects.',
                  'Don\'t enter pool until you can see bottom.'
                ]
              },
              {
                title: 'Debris Removal',
                steps: [
                  'Remove large debris by hand first.',
                  'Use a leaf rake for smaller stuff.',
                  'Remove furniture you threw in.',
                  'Don\'t vacuum until pump is running.',
                  'Bag debris - don\'t blow into yard.'
                ]
              },
              {
                title: 'Equipment Restart',
                steps: [
                  'Inspect all equipment for damage.',
                  'Check pump for debris in basket.',
                  'Prime pump before starting.',
                  'Turn on breakers one at a time.',
                  'Listen for unusual sounds.',
                  'Check for leaks at all connections.'
                ]
              },
              {
                title: 'Water Recovery',
                steps: [
                  'Test all chemical levels.',
                  '**Triple shock** the pool.',
                  'Run pump 24/7 until clear.',
                  'Backwash filter frequently.',
                  'Add algaecide as prevention.',
                  'May take 3-7 days to fully recover.'
                ]
              }
            ]
          }
        }
      ]
    },
    {
      id: 'equipment-guide',
      title: 'Equipment Guide',
      icon: 'Wrench',
      description: 'Complete specs for Jandy, Pentair & Hayward equipment',
      gradient: 'from-emerald-500 via-teal-500 to-cyan-500',
      bgGlow: 'bg-emerald-500/20',
      topics: [
        {
          id: 'pool-pumps',
          title: 'Pool Pumps',
          tags: ['pump', 'motor', 'variable speed', 'VS', 'IntelliFlo', 'TriStar', 'FloPro', 'SuperFlo', 'WhisperFlo', 'Jandy', 'Pentair', 'Hayward'],
          severity: 'low',
          content: {
            summary: "Compare variable speed, single speed, and booster pumps from all major brands.",
            floridaNote: "FL law requires variable speed pumps for new construction and replacements over 1 HP. VS pumps save 70-80% on energy costs in our year-round climate.",
            sections: [
              {
                title: 'Pentair Variable Speed Pumps',
                steps: [
                  '**IntelliFlo 3 VSF** - Top tier, 3.2 THP, built-in automation, flow sensor, WiFi ready.',
                  '**IntelliFlo VSF** - Variable speed + flow, 3.0 THP, drop-in retrofit.',
                  '**SuperFlo VS** - Budget-friendly, 1.5 THP, great for smaller pools.',
                  'All use EC motors - no capacitor or seal replacements.',
                  'Compatible with **IntelliCenter, EasyTouch, SunTouch** automation.',
                  'Error codes: E01=Flow, E02=Overload, E04=Overheat, E06=Current fault.'
                ]
              },
              {
                title: 'Hayward Variable Speed Pumps',
                steps: [
                  '**TriStar VS 950** - 2.7 THP, OmniDirect compatible, quiet operation.',
                  '**TriStar VS 900** - 2.0 THP, union fittings, drop-in replacement.',
                  '**MaxFlo VS 500** - Entry level, 1.65 THP, great retrofit option.',
                  '**Super Pump VS 700** - Most popular, 1.65 THP, fits Super Pump footprint.',
                  'Compatible with **OmniLogic, OmniHub, ProLogic, Aqua Plus** systems.',
                  'Uses **RS-485** communication protocol for automation.'
                ]
              },
              {
                title: 'Jandy Variable Speed Pumps',
                steps: [
                  '**VS FloPro 2.7** - Premium, 2.7 THP, built-in JEP-R controller.',
                  '**VS FloPro 1.85** - Mid-range, 1.85 THP, fits legacy footprints.',
                  '**ePump** - Classic variable speed with external controls.',
                  'Native integration with **iAquaLink, AquaLink RS, PDA** systems.',
                  'Modbus/RS-485 communication for seamless automation.',
                  'Speed range: 600-3450 RPM with 8 programmable speeds.'
                ]
              },
              {
                title: 'Booster Pumps (Pressure Cleaners)',
                steps: [
                  '**Pentair PB4-60** - 60 GPM, for Polaris 280/380/3900.',
                  '**Hayward W36060** - 6060 model, for Tigershark/Phantom cleaners.',
                  '**Jandy PB460** - Reliable, long-lasting motor.',
                  'All create 30+ PSI boost for pressure-side cleaners.',
                  'Run only when cleaner is operating to save energy.'
                ]
              }
            ]
          }
        },
        {
          id: 'pool-filters',
          title: 'Pool Filters',
          tags: ['filter', 'sand', 'cartridge', 'DE', 'diatomaceous', 'Jandy', 'Pentair', 'Hayward', 'clean', 'backwash'],
          severity: 'low',
          content: {
            summary: "Sand, cartridge, and DE filters - sizing, maintenance, and brand comparisons.",
            floridaNote: "FL pools run 8-12 hours/day year-round. Cartridge filters need cleaning every 2-4 weeks. DE grids typically last 5-7 years here.",
            sections: [
              {
                title: 'Pentair Filters',
                steps: [
                  '**Clean & Clear Plus (Cartridge)** - 320/420/520 sq ft, easy-open lid.',
                  '**Quad DE** - 60/80/100 sq ft, 4-grid design, easy cleaning.',
                  '**Triton II (Sand)** - 3.14 sq ft filter area, top-mount multiport.',
                  '**FNS Plus (DE)** - 24-60 sq ft, vertical grid, bump handle optional.',
                  'Clean pressure gauge: 8-10 PSI. Clean at +10 PSI above baseline.',
                  'Cartridge replacement: Every 1-2 years with proper maintenance.'
                ]
              },
              {
                title: 'Hayward Filters',
                steps: [
                  '**SwimClear (Cartridge)** - C2030/C3030/C4030/C5030 (225-525 sq ft).',
                  '**ProGrid DE** - 24-72 sq ft, quick-release clamp, easy service.',
                  '**Pro-Series (Sand)** - 1.75-3.14 sq ft, side or top mount.',
                  '**Star-Clear Plus (Cartridge)** - Budget option, 90-175 sq ft.',
                  'Uses standard 7" x 30" cartridges (C2030).',
                  'DE requirement: 1 lb per 5 sq ft of filter area.'
                ]
              },
              {
                title: 'Jandy Filters',
                steps: [
                  '**CL/CV Series (Cartridge)** - 340/460/580 sq ft, top-load design.',
                  '**DEL Series (DE)** - 36-60 sq ft, large capacity grids.',
                  '**JS Series (Sand)** - 50/75/100 GPM, top-mount multiport.',
                  'Quick-release collar makes cleaning fast.',
                  'Optional Versa Plumb for 360° rotation during install.'
                ]
              },
              {
                title: 'Filter Sizing Guide',
                steps: [
                  '**Rule of thumb**: 1 sq ft cartridge per 10,000 gallons.',
                  'Sand filters: Size for pool GPM ÷ 15 = required sq ft.',
                  'DE filters: Most efficient, 1 sq ft per 5,000 gallons.',
                  'Oversizing = longer filter cycles, less maintenance.',
                  'Check flow rates match pump output for optimal performance.'
                ]
              }
            ]
          }
        },
        {
          id: 'salt-chlorinators',
          title: 'Salt Chlorine Generators',
          tags: ['salt', 'cell', 'chlorinator', 'generator', 'IntelliChlor', 'AquaRite', 'AquaPure', 'Jandy', 'Pentair', 'Hayward', 'SCG'],
          severity: 'low',
          content: {
            summary: "Compare salt systems, cell life, and maintenance across all brands.",
            floridaNote: "FL hard water (300+ ppm calcium) scales cells fast. Clean every 3 months minimum. Target 3200 ppm salt, pH 7.2-7.4 for maximum cell life.",
            sections: [
              {
                title: 'Pentair IntelliChlor',
                steps: [
                  '**IC20** - Up to 20,000 gallons, 0.70 lbs chlorine/day.',
                  '**IC40** - Up to 40,000 gallons, 1.40 lbs chlorine/day.',
                  '**IC60** - Up to 60,000 gallons, 2.0 lbs chlorine/day.',
                  'Cell life: **10,000 hours** (~5 years typical).',
                  'Salt range: **2700-3400 ppm** (ideal 3200 ppm).',
                  'Self-cleaning via reverse polarity every 10 hours.',
                  'Integrates with **IntelliCenter, EasyTouch, ScreenLogic**.',
                  'Flow switch included - prevents dry running.'
                ]
              },
              {
                title: 'Hayward AquaRite Series',
                steps: [
                  '**AquaRite S3** - WiFi enabled, app control, any pool size.',
                  '**AquaRite 900** - Standard model, up to 25,000 gallons.',
                  '**AquaRite 925/940** - Mid-tier, 25K/40K gallons.',
                  '**AquaTrol** - Above-ground pool version, plug-and-play.',
                  'T-Cell-15 for 40K gal, T-Cell-9 for 25K gal, T-Cell-3 for 15K.',
                  'Cell life: **10,000 hours**, 5-year limited warranty.',
                  'Works with **OmniLogic, OmniHub, ProLogic, AquaPlus**.',
                  'Diagnostics: Check Cell, Inspect Cell, Low Salt, High Salt LED indicators.'
                ]
              },
              {
                title: 'Jandy AquaPure Series',
                steps: [
                  '**AquaPure 1400** - Up to 40,000 gallons, 1.4 lbs/day.',
                  '**AquaPure 700** - Up to 25,000 gallons, 0.7 lbs/day.',
                  '**TruClear** - Compact, up to 28,000 gallons.',
                  'PureLink (older model) - Still widely installed.',
                  'Salt range: **2700-3400 ppm** (ideal 3000-3200 ppm).',
                  'Cell life: **10,000+ hours** with proper maintenance.',
                  'Native **iAquaLink** and **AquaLink** integration.',
                  'Reverse polarity self-cleaning every 8 hours.'
                ]
              },
              {
                title: 'Salt Cell Maintenance',
                steps: [
                  '**Inspect monthly** - Look for white scale buildup.',
                  '**Clean every 3-4 months** in FL (more often with hard water).',
                  'Use 4:1 water to muriatic acid solution (NEVER stronger).',
                  'Soak 5-10 minutes max, rinse thoroughly.',
                  'Over-cleaning shortens cell life - only clean when needed.',
                  '**Check salt weekly** - Salt depletes through splash-out, rain.',
                  'Replace cells when output drops below 60% at max production.'
                ]
              }
            ]
          }
        },
        {
          id: 'control-panels',
          title: 'Control Panels & Automation',
          tags: ['automation', 'control', 'IntelliCenter', 'OmniLogic', 'AquaLink', 'iAquaLink', 'ScreenLogic', 'WiFi', 'app', 'Jandy', 'Pentair', 'Hayward'],
          severity: 'low',
          content: {
            summary: "Automation systems, compatibility, and communication protocols for smart pool control.",
            floridaNote: "WiFi-enabled panels let you control your pool from anywhere - great for snowbirds who need to maintain pools remotely during FL summers.",
            sections: [
              {
                title: 'Pentair Automation',
                steps: [
                  '**IntelliCenter** - Top tier, touchscreen, up to 100 devices.',
                  '**EasyTouch** - Popular mid-range, up to 8 circuits + aux.',
                  '**SunTouch** - Entry level, single body of water.',
                  '**ScreenLogic** - Add-on for WiFi/app control on older systems.',
                  'Uses RS-485 protocol for all IntelliFlo, IntelliChlor devices.',
                  'Firmware updates available via ScreenLogic app.',
                  'Compatible equipment: All Pentair pumps, salt cells, heaters, lights.'
                ]
              },
              {
                title: 'Hayward Automation',
                steps: [
                  '**OmniLogic** - Premium, color touchscreen, 40+ devices.',
                  '**OmniHub** - Smart upgrade for existing ProLogic/PS systems.',
                  '**ProLogic** - Proven reliability, PS-4/PS-8/PS-16 options.',
                  '**AquaPlus** - Standalone salt cell controller with relay outputs.',
                  'Uses RS-485 communication, OmniDirect for smart pumps.',
                  'Native Alexa, Google Home, Apple HomeKit support.',
                  'Compatible: All Hayward pumps, AquaRite cells, heaters, LED lights.'
                ]
              },
              {
                title: 'Jandy Automation',
                steps: [
                  '**iAquaLink 3.0** - Latest web-enabled, full app control.',
                  '**AquaLink RS** - Classic system, OneTouch/PDA/Combo.',
                  '**AquaLink PDA** - Palm-size wireless controller.',
                  '**AquaPalm** - Handheld wireless remote option.',
                  'Modbus/RS-485 protocol for all Jandy devices.',
                  'Native integration with ePump, VS FloPro, AquaPure.',
                  'Web Connect for remote monitoring and control.'
                ]
              },
              {
                title: 'Cross-Brand Compatibility',
                warning: 'Mixing brands is possible but NOT recommended. Automation features may be limited.',
                steps: [
                  '**Pentair + Hayward/Jandy**: Use relay outputs only, no RS-485.',
                  '**Hayward + Pentair/Jandy**: OmniHub relay mode, basic on/off.',
                  '**Jandy + Pentair/Hayward**: AquaLink relay control only.',
                  'Smart features (variable speeds, diagnostics) require matched brands.',
                  'Salt cells from different brands won\'t communicate pool data.',
                  'Rule: Match automation to your primary equipment brand.'
                ]
              },
              {
                title: 'Common Automation Issues',
                steps: [
                  '**No communication**: Check RS-485 wiring, A/B polarity.',
                  '**Pump not responding**: Verify address settings match panel.',
                  '**WiFi disconnects**: Update firmware, check router 2.4GHz band.',
                  '**App not syncing**: Power cycle panel, refresh app registration.',
                  '**Lost schedules after power outage**: Backup programming regularly.',
                  '**Check service manual** for brand-specific error codes.'
                ]
              }
            ]
          }
        }
      ]
    }
  ]
};


// ============================================
// ICON MAPPING
// ============================================

const iconMap = {
  AlertTriangle,
  Wrench,
  ThermometerSun,
  CloudRain,
  Droplets,
  Bug,
  Leaf,
  CircuitBoard,
  Gauge
};

// ============================================
// COMPONENTS - MODERN REDESIGN
// ============================================

function WarningBox({ children }) {
  return (
    <div className="flex items-start gap-3 p-4 bg-gradient-to-r from-red-500/10 to-rose-500/10 border border-red-300/50 rounded-xl my-4 backdrop-blur-sm">
      <div className="p-1.5 bg-red-500 rounded-lg shadow-lg shadow-red-500/30">
        <AlertCircle className="w-4 h-4 text-white" />
      </div>
      <p className="text-sm text-red-800 font-medium leading-relaxed">{children}</p>
    </div>
  );
}

function FloridaNote({ children }) {
  return (
    <div className="flex items-start gap-3 p-4 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-yellow-500/10 border border-amber-300/50 rounded-xl my-4 backdrop-blur-sm">
      <div className="p-1.5 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg shadow-lg shadow-amber-500/30">
        <ThermometerSun className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 uppercase tracking-wide">
          <Sparkles className="w-3 h-3" />
          Florida Factor
        </span>
        <p className="text-sm text-amber-800 mt-1 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function StepList({ steps }) {
  return (
    <ul className="space-y-2.5 mt-3">
      {steps.map((step, idx) => (
        <li key={idx} className="flex items-start gap-3 text-sm text-slate-700 group">
          <div className="mt-0.5 p-0.5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-sm group-hover:shadow-emerald-500/30 transition-shadow">
            <CheckCircle className="w-3.5 h-3.5 text-white" />
          </div>
          <span
            className="leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: step.replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-900 font-semibold">$1</strong>')
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function TopicCard({ topic, isExpanded, onToggle }) {
  const severityConfig = {
    high: {
      border: 'border-red-400/50',
      bg: 'bg-gradient-to-br from-red-50/80 to-rose-50/80',
      badge: 'bg-red-500 text-white',
      glow: 'hover:shadow-red-200/50'
    },
    medium: {
      border: 'border-amber-400/50',
      bg: 'bg-gradient-to-br from-amber-50/80 to-yellow-50/80',
      badge: 'bg-amber-500 text-white',
      glow: 'hover:shadow-amber-200/50'
    },
    low: {
      border: 'border-emerald-400/50',
      bg: 'bg-gradient-to-br from-emerald-50/80 to-teal-50/80',
      badge: 'bg-emerald-500 text-white',
      glow: 'hover:shadow-emerald-200/50'
    }
  };

  const config = severityConfig[topic.severity] || severityConfig.low;

  return (
    <div
      className={`
        rounded-2xl border-2 ${config.border} ${config.bg} 
        backdrop-blur-sm overflow-hidden 
        transition-all duration-300 ease-out
        hover:shadow-xl ${config.glow}
        ${isExpanded ? 'shadow-lg' : 'shadow-sm'}
      `}
    >
      <button
        onClick={onToggle}
        className="w-full p-4 sm:p-5 flex items-center justify-between text-left transition-colors touch-manipulation"
      >
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">{topic.title}</h3>
            {topic.severity !== 'low' && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${config.badge}`}>
                {topic.severity}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">{topic.content.summary}</p>
        </div>
        <div className={`
          flex-shrink-0 w-10 h-10 flex items-center justify-center 
          rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/50
          shadow-sm transition-all duration-300
          ${isExpanded ? 'rotate-180 bg-slate-100' : ''}
        `}>
          <ChevronDown className="w-5 h-5 text-slate-500" />
        </div>
      </button>

      <div className={`
        overflow-hidden transition-all duration-300 ease-out
        ${isExpanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'}
      `}>
        <div className="px-4 sm:px-5 pb-5 border-t border-slate-200/50 pt-4">
          {topic.content.floridaNote && (
            <FloridaNote>{topic.content.floridaNote}</FloridaNote>
          )}

          <div className="space-y-5">
            {topic.content.sections.map((section, idx) => (
              <div key={idx} className="bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-slate-200/50">
                <h4 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" />
                  {section.title}
                </h4>
                {section.warning && <WarningBox>{section.warning}</WarningBox>}
                <StepList steps={section.steps} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CategorySection({ category, searchQuery, expandedTopics, toggleTopic, isActiveCategory }) {
  const IconComponent = iconMap[category.icon] || AlertTriangle;

  const filteredTopics = useMemo(() => {
    if (!searchQuery) return category.topics;
    const query = searchQuery.toLowerCase();
    return category.topics.filter(topic =>
      topic.title.toLowerCase().includes(query) ||
      topic.tags.some(tag => tag.includes(query)) ||
      topic.content.summary.toLowerCase().includes(query)
    );
  }, [category.topics, searchQuery]);

  if (filteredTopics.length === 0) return null;

  return (
    <div className={`transition-all duration-500 ${isActiveCategory ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'}`}>
      {/* Category Header - More Prominent */}
      <div className="flex items-center gap-4 mb-6">
        <div className={`p-3 bg-gradient-to-br ${category.gradient} rounded-2xl shadow-lg`}>
          <IconComponent className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{category.title}</h2>
          <p className="text-sm text-slate-600">{category.description}</p>
        </div>
        <span className="px-3 py-1.5 bg-slate-100 rounded-full text-sm font-medium text-slate-600">
          {filteredTopics.length} {filteredTopics.length === 1 ? 'topic' : 'topics'}
        </span>
      </div>

      {/* Topics Grid */}
      <div className="space-y-4">
        {filteredTopics.map(topic => (
          <TopicCard
            key={topic.id}
            topic={topic}
            isExpanded={expandedTopics.has(topic.id)}
            onToggle={() => toggleTopic(topic.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT - MODERN REDESIGN
// ============================================

export default function PoolSchool() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTopics, setExpandedTopics] = useState(new Set());
  const [activeCategory, setActiveCategory] = useState(POOL_SCHOOL_DATA.categories[0].id);

  const toggleTopic = (topicId) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  const expandAll = () => {
    const currentCat = POOL_SCHOOL_DATA.categories.find(c => c.id === activeCategory);
    if (currentCat) {
      const catTopicIds = currentCat.topics.map(t => t.id);
      setExpandedTopics(prev => new Set([...prev, ...catTopicIds]));
    }
  };

  const collapseAll = () => {
    const currentCat = POOL_SCHOOL_DATA.categories.find(c => c.id === activeCategory);
    if (currentCat) {
      const catTopicIds = new Set(currentCat.topics.map(t => t.id));
      setExpandedTopics(prev => {
        const next = new Set(prev);
        catTopicIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const totalTopics = POOL_SCHOOL_DATA.categories.reduce(
    (sum, cat) => sum + cat.topics.length, 0
  );

  const filteredCount = useMemo(() => {
    if (!searchQuery) return totalTopics;
    const query = searchQuery.toLowerCase();
    return POOL_SCHOOL_DATA.categories.reduce((sum, cat) => {
      return sum + cat.topics.filter(topic =>
        topic.title.toLowerCase().includes(query) ||
        topic.tags.some(tag => tag.includes(query)) ||
        topic.content.summary.toLowerCase().includes(query)
      ).length;
    }, 0);
  }, [searchQuery, totalTopics]);

  // When searching, show all categories
  const showAllCategories = searchQuery.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50/30 to-blue-50/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-28">

        {/* Hero Header */}
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-teal-500/20 rounded-3xl blur-3xl" />
          <div className="relative bg-white/70 backdrop-blur-xl rounded-3xl border border-white/50 shadow-xl p-6 sm:p-8">
            <div className="flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 bg-clip-text text-transparent">
                Pool School
              </h1>
              <p className="text-slate-600 mt-1 text-sm sm:text-base">
                Florida pool tech's complete field guide
              </p>
              <div className="flex items-center gap-3 mt-3">
                <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                  {totalTopics} Topics
                </span>
                <span className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-full text-xs font-medium">
                  {POOL_SCHOOL_DATA.categories.length} Categories
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Search Bar - Floating */}
        <div className="sticky top-2 z-20 mb-6">
          <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/50 shadow-lg p-2">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search problems, equipment, brands..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-12 py-3.5 bg-slate-50/80 border-0 rounded-xl text-base text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-cyan-500 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quick Actions */}
            {!searchQuery && (
              <div className="flex items-center justify-between mt-2 px-2">
                <span className="text-xs text-slate-500">
                  {filteredCount} topics available
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={expandAll}
                    className="text-xs text-cyan-600 hover:text-cyan-700 font-medium px-3 py-1.5 hover:bg-cyan-50 rounded-lg transition-colors"
                  >
                    Expand All
                  </button>
                  <button
                    onClick={collapseAll}
                    className="text-xs text-slate-500 hover:text-slate-700 font-medium px-3 py-1.5 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    Collapse
                  </button>
                </div>
              </div>
            )}

            {searchQuery && (
              <div className="mt-2 px-2">
                <span className="text-xs text-slate-500">
                  Found {filteredCount} {filteredCount === 1 ? 'topic' : 'topics'} matching "{searchQuery}"
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Category Tabs - Horizontal Scroll */}
        {!searchQuery && (
          <div className="mb-8 -mx-4 px-4">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {POOL_SCHOOL_DATA.categories.map(cat => {
                const IconComponent = iconMap[cat.icon] || AlertTriangle;
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`
                      flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl
                      font-medium text-sm transition-all duration-300
                      ${isActive
                        ? `bg-gradient-to-r ${cat.gradient} text-white shadow-lg`
                        : 'bg-white/80 text-slate-700 hover:bg-white hover:shadow-md border border-slate-200/50'
                      }
                    `}
                  >
                    <IconComponent className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                    <span className="whitespace-nowrap">{cat.title}</span>
                    <span className={`
                      px-1.5 py-0.5 rounded-md text-xs font-bold
                      ${isActive ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}
                    `}>
                      {cat.topics.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="relative min-h-[400px]">
          {showAllCategories ? (
            // Search results mode - show all matching categories
            <div className="space-y-10">
              {POOL_SCHOOL_DATA.categories.map(category => (
                <div key={category.id}>
                  <CategorySection
                    category={category}
                    searchQuery={searchQuery}
                    expandedTopics={expandedTopics}
                    toggleTopic={toggleTopic}
                    isActiveCategory={true}
                  />
                </div>
              ))}
            </div>
          ) : (
            // Tab mode - show active category only
            POOL_SCHOOL_DATA.categories.map(category => (
              <CategorySection
                key={category.id}
                category={category}
                searchQuery={searchQuery}
                expandedTopics={expandedTopics}
                toggleTopic={toggleTopic}
                isActiveCategory={activeCategory === category.id}
              />
            ))
          )}
        </div>

        {/* No Results */}
        {filteredCount === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-slate-100 to-slate-200 rounded-3xl flex items-center justify-center">
              <Search className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">No topics found</h3>
            <p className="text-slate-600 max-w-md mx-auto">
              Try different keywords like "pump", "algae", or brand names like "Pentair" or "Hayward".
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
