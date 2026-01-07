import React, { useState, useMemo } from 'react';
import {
  Search,
  BookOpen,
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
  Info
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
  Leaf
};

// ============================================
// COMPONENTS
// ============================================

function WarningBox({ children }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg my-3">
      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-red-800 font-medium">{children}</p>
    </div>
  );
}

function FloridaNote({ children }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg my-3">
      <ThermometerSun className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div>
        <span className="text-xs font-bold text-amber-700 uppercase">Florida Factor</span>
        <p className="text-sm text-amber-800">{children}</p>
      </div>
    </div>
  );
}

function StepList({ steps }) {
  return (
    <ul className="space-y-2 mt-2">
      {steps.map((step, idx) => (
        <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
          <span dangerouslySetInnerHTML={{ 
            __html: step.replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-900">$1</strong>') 
          }} />
        </li>
      ))}
    </ul>
  );
}

function TopicCard({ topic, isExpanded, onToggle }) {
  const severityColors = {
    high: 'border-l-red-500 bg-red-50/30',
    medium: 'border-l-amber-500 bg-amber-50/30',
    low: 'border-l-green-500 bg-green-50/30'
  };

  return (
    <Card className={`overflow-hidden border-l-4 ${severityColors[topic.severity] || 'border-l-slate-300'}`}>
      <button
        onClick={onToggle}
        className="w-full p-3 sm:p-4 flex items-center justify-between text-left hover:bg-slate-50 active:bg-slate-100 transition-colors touch-manipulation"
      >
        <div className="flex-1 min-w-0 pr-2">
          <h3 className="font-semibold text-slate-900 text-sm sm:text-base">{topic.title}</h3>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5 line-clamp-2">{topic.content.summary}</p>
        </div>
        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>
      
      {isExpanded && (
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t border-slate-100">
          {topic.content.floridaNote && (
            <FloridaNote>{topic.content.floridaNote}</FloridaNote>
          )}
          
          {topic.content.sections.map((section, idx) => (
            <div key={idx} className="mt-3 sm:mt-4">
              <h4 className="font-medium text-slate-900 text-sm">{section.title}</h4>
              {section.warning && <WarningBox>{section.warning}</WarningBox>}
              <StepList steps={section.steps} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CategorySection({ category, searchQuery, expandedTopics, toggleTopic }) {
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
    <div className="mb-6 sm:mb-8">
      <div className="flex items-center gap-3 mb-3 sm:mb-4">
        <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex-shrink-0">
          <IconComponent className="w-4 sm:w-5 h-4 sm:h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">{category.title}</h2>
          <p className="text-xs sm:text-sm text-slate-600 truncate">{category.description}</p>
        </div>
      </div>
      
      <div className="space-y-2 sm:space-y-3">
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
// MAIN COMPONENT
// ============================================

export default function PoolSchool() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTopics, setExpandedTopics] = useState(new Set());

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
    const allIds = POOL_SCHOOL_DATA.categories.flatMap(cat => 
      cat.topics.map(t => t.id)
    );
    setExpandedTopics(new Set(allIds));
  };

  const collapseAll = () => {
    setExpandedTopics(new Set());
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

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-24">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg">
            <BookOpen className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Pool School</h1>
            <p className="text-xs sm:text-sm text-slate-600">Florida tech's field guide</p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 via-slate-50 to-transparent pb-3 sm:pb-4 -mx-3 sm:-mx-4 px-3 sm:px-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search problems, equipment..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-base text-slate-900 placeholder-slate-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 active:bg-slate-100 rounded-full"
            >
              ×
            </button>
          )}
        </div>
        
        {/* Quick Actions */}
        <div className="flex items-center justify-between mt-2 sm:mt-3">
          <span className="text-xs sm:text-sm text-slate-500">
            {filteredCount} topic{filteredCount !== 1 ? 's' : ''} 
            {searchQuery && <span className="hidden sm:inline"> matching "{searchQuery}"</span>}
          </span>
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="text-xs text-cyan-600 hover:text-cyan-700 font-medium px-2 py-1 active:bg-cyan-50 rounded"
            >
              Expand All
            </button>
            <span className="text-slate-300">|</span>
            <button
              onClick={collapseAll}
              className="text-xs text-cyan-600 hover:text-cyan-700 font-medium px-2 py-1 active:bg-cyan-50 rounded"
            >
              Collapse All
            </button>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      {!searchQuery && (
        <div className="grid grid-cols-2 gap-2 mb-4 sm:mb-6">
          {POOL_SCHOOL_DATA.categories.map(cat => {
            const IconComponent = iconMap[cat.icon] || AlertTriangle;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  document.getElementById(cat.id)?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 active:bg-slate-100 transition-colors text-left touch-manipulation"
              >
                <IconComponent className="w-4 h-4 text-cyan-600 flex-shrink-0" />
                <span className="text-xs sm:text-sm font-medium text-slate-700 truncate">{cat.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      {POOL_SCHOOL_DATA.categories.map(category => (
        <div key={category.id} id={category.id}>
          <CategorySection
            category={category}
            searchQuery={searchQuery}
            expandedTopics={expandedTopics}
            toggleTopic={toggleTopic}
          />
        </div>
      ))}

      {/* No Results */}
      {filteredCount === 0 && (
        <div className="text-center py-12">
          <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No topics found</h3>
          <p className="text-slate-600">Try different keywords or browse categories above.</p>
        </div>
      )}

      {/* Footer Tip */}
      <div className="mt-6 sm:mt-8 p-3 sm:p-4 bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200 rounded-xl">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs sm:text-sm font-medium text-cyan-900">Pro Tip</p>
            <p className="text-xs sm:text-sm text-cyan-700">
              Bookmark this page for quick access in the field. Works offline once loaded.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
