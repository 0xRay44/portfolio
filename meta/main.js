import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

// Shared between the scatterplot and the brush handlers
let xScale;
let yScale;

// ---------- Data ----------

async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line),
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

function processCommits(data) {
  const commits = d3
    .groups(data, (d) => d.commit)
    .map(([commit, lines]) => {
      let first = lines[0];
      let { author, date, time, timezone, datetime } = first;
      let ret = {
        id: commit,
        url: 'https://github.com/0xRay44/portfolio/commit/' + commit,
        author,
        date,
        time,
        timezone,
        datetime,
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        totalLines: lines.length,
      };

      // Keep the raw lines around without cluttering console output
      Object.defineProperty(ret, 'lines', {
        value: lines,
        enumerable: false,
        writable: false,
        configurable: false,
      });

      return ret;
    });

  // Oldest first, so the scrolly story reads in order
  return d3.sort(commits, (d) => d.datetime);
}

// ---------- Summary stats ----------

function renderCommitInfo(data, commits) {
  const container = d3.select('#stats');
  container.selectAll('*').remove();
  const dl = container.append('dl').attr('class', 'stats');

  // Total lines of code
  dl.append('dt').html('Total <abbr title="Lines of code">LOC</abbr>');
  dl.append('dd').text(data.length);

  // Total commits
  dl.append('dt').text('Commits');
  dl.append('dd').text(commits.length);

  // Number of distinct files
  dl.append('dt').text('Files');
  dl.append('dd').text(d3.group(data, (d) => d.file).size);

  // Average file length: longest line number in each file, then the mean
  const fileLengths = d3.rollups(
    data,
    (v) => d3.max(v, (v) => v.line),
    (d) => d.file,
  );
  const averageFileLength = d3.mean(fileLengths, (d) => d[1]) ?? 0;
  dl.append('dt').text('Avg file length');
  dl.append('dd').text(Math.round(averageFileLength) + ' lines');

  // Longest line, in characters
  dl.append('dt').text('Longest line');
  dl.append('dd').text((d3.max(data, (d) => d.length) ?? 0) + ' chars');

  // Deepest indentation
  dl.append('dt').text('Max depth');
  dl.append('dd').text(d3.max(data, (d) => d.depth) ?? 0);

  // Time of day most of the work happened
  const workByPeriod = d3.rollups(
    data,
    (v) => v.length,
    (d) => new Date(d.datetime).toLocaleString('en', { dayPeriod: 'short' }),
  );
  const maxPeriod = d3
    .greatest(workByPeriod, (d) => d[1])?.[0]
    ?.replace(/^in the /, '');
  dl.append('dt').text('Most work done');
  dl.append('dd').text(maxPeriod ?? '–');
}

// ---------- Tooltip ----------

function renderTooltipContent(commit) {
  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');
  const time = document.getElementById('commit-clock');
  const author = document.getElementById('commit-author');
  const lines = document.getElementById('commit-lines');

  if (Object.keys(commit).length === 0) return;

  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime?.toLocaleString('en', {
    dateStyle: 'full',
  });
  time.textContent = commit.datetime?.toLocaleString('en', {
    timeStyle: 'short',
  });
  author.textContent = commit.author;
  lines.textContent = commit.totalLines;
}

function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  const offset = 12;
  const { width, height } = tooltip.getBoundingClientRect();

  // Sit just below-right of the cursor, flipping to the other side near an edge
  let left = event.clientX + offset;
  let top = event.clientY + offset;
  if (left + width > window.innerWidth) left = event.clientX - offset - width;
  if (top + height > window.innerHeight) top = event.clientY - offset - height;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// ---------- Scatterplot ----------

const width = 1000;
const height = 600;
const margin = { top: 10, right: 20, bottom: 40, left: 70 };

const usableArea = {
  top: margin.top,
  right: width - margin.right,
  bottom: height - margin.bottom,
  left: margin.left,
  width: width - margin.left - margin.right,
  height: height - margin.top - margin.bottom,
};

// Builds the parts of the chart that never change (frame, gridlines, y axis,
// brush), then draws the dots and x axis through updateScatterPlot
function renderScatterPlot(data, commits) {
  const svg = d3
    .select('#chart')
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  xScale = d3.scaleTime().range([usableArea.left, usableArea.right]);

  yScale = d3
    .scaleLinear()
    .domain([0, 24])
    .range([usableArea.bottom, usableArea.top]);

  // Gridlines first, so they sit behind the dots
  const gridlines = svg
    .append('g')
    .attr('class', 'gridlines')
    .attr('transform', `translate(${usableArea.left}, 0)`);

  gridlines.call(d3.axisLeft(yScale).tickFormat('').tickSize(-usableArea.width));

  // Tint each gridline by hour: blue at night, orange in the middle of the day
  gridlines
    .selectAll('.tick line')
    .attr('stroke', (d) => d3.interpolateRdYlBu(1 - Math.sin((Math.PI * d) / 24)));

  svg.append('g').attr('class', 'dots');

  svg
    .append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${usableArea.bottom})`);

  const yAxis = d3
    .axisLeft(yScale)
    .ticks(6)
    .tickFormat((d) => String(d % 24).padStart(2, '0') + ':00');

  svg
    .append('g')
    .attr('class', 'y-axis')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .call(yAxis);

  createBrushSelector(svg);
  updateScatterPlot(data, commits);
}

function updateScatterPlot(data, commits) {
  const svg = d3.select('#chart').select('svg');

  // x domain follows the visible commits; pad a lone commit by a day each side
  let [start, end] = d3.extent(commits, (d) => d.datetime);
  if (+start === +end) {
    start = d3.timeDay.offset(start, -1);
    end = d3.timeDay.offset(end, 1);
  }
  xScale.domain([start, end]).nice();

  // Dot size: square root scale so area, not radius, tracks lines edited
  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  const rScale = d3.scaleSqrt().domain([minLines, maxLines]).range([3, 30]);

  const xAxis = d3.axisBottom(xScale).ticks(5);
  const xAxisGroup = svg.select('g.x-axis');
  xAxisGroup.selectAll('*').remove();
  xAxisGroup.call(xAxis);

  // Biggest commits first, so small dots are drawn on top and stay hoverable
  const sortedCommits = d3.sort(commits, (d) => -d.totalLines);

  svg
    .select('g.dots')
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .style('--r', (d) => rScale(d.totalLines))
    .attr('fill', 'steelblue')
    .style('fill-opacity', 0.7)
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('click', (event, commit) => {
      window.open(commit.url, '_blank');
    })
    .on('mousemove', (event) => {
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });
}

// ---------- Brushing ----------

let brushSelection = null;

function createBrushSelector(svg) {
  svg.call(d3.brush().on('start brush end', brushed));

  // The brush overlay swallows mouse events, so move the dots (and anything
  // drawn after the overlay) back on top of it
  svg.selectAll('.dots, .overlay ~ *').raise();
}

function isCommitSelected(selection, commit) {
  if (!selection) {
    return false;
  }
  const [[x0, y0], [x1, y1]] = selection;
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function brushed(event) {
  brushSelection = event.selection;
  renderBrushState();
}

function renderBrushState() {
  const selection = brushSelection;
  d3.selectAll('#chart circle').classed('selected', (d) =>
    isCommitSelected(selection, d),
  );
  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function renderSelectionCount(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];

  const countElement = document.querySelector('#selection-count');
  countElement.textContent = `${
    selectedCommits.length || 'No'
  } commits selected`;

  return selectedCommits;
}

function renderLanguageBreakdown(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];
  const container = document.getElementById('language-breakdown');

  if (selectedCommits.length === 0) {
    container.innerHTML = '';
    return;
  }
  const lines = selectedCommits.flatMap((d) => d.lines);

  // Count lines per language
  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type,
  );

  container.innerHTML = '';

  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format('.1~%')(proportion);

    container.innerHTML += `
      <dt>${language}</dt>
      <dd>${count} lines (${formatted})</dd>
    `;
  }
}

// ---------- Files: one dot per line of code ----------

let colors;

function getFiles(commits) {
  const lines = commits.flatMap((d) => d.lines);
  return d3
    .groups(lines, (d) => d.file)
    .map(([name, lines]) => ({ name, lines, type: lines[0].type }))
    .sort((a, b) => b.lines.length - a.lines.length);
}

function renderFilesLegend(allCommits) {
  const types = colors.domain();
  const counts = d3.rollup(
    allCommits.flatMap((d) => d.lines),
    (v) => v.length,
    (d) => d.type,
  );

  d3.select('#files-legend')
    .selectAll('li')
    .data(types)
    .join('li')
    .style('--color', (d) => colors(d))
    .html((d) => `<span class="swatch"></span>${d} <small>${counts.get(d)}</small>`);
}

function updateFileDisplay(commits) {
  const files = getFiles(commits);

  const filesContainer = d3
    .select('#files')
    .selectAll('div')
    .data(files, (d) => d.name)
    .join((enter) =>
      enter.append('div').call((div) => {
        const dt = div.append('dt');
        dt.append('code');
        dt.append('small');
        div.append('dd');
      }),
    );

  filesContainer.style('--color', (d) => colors(d.type));
  filesContainer.select('dt > code').text((d) => d.name);
  filesContainer.select('dt > small').text((d) => `${d.lines.length} lines`);

  filesContainer
    .select('dd')
    .selectAll('div')
    .data((d) => d.lines)
    .join('div')
    .attr('class', 'loc');
}

// ---------- Time filter (slider + scrollytelling) ----------

let commitProgress = 100;
let timeScale;
let commitMaxTime;
let filteredCommits;

const dateTimeFormat = { dateStyle: 'long', timeStyle: 'short' };

function filterUpTo(maxTime) {
  return commits.filter((d) => d.datetime <= maxTime);
}

// Everything in the first scrolly section follows one cut-off time
function updateToTime(maxTime) {
  commitMaxTime = maxTime;
  filteredCommits = filterUpTo(commitMaxTime);

  document.getElementById('commit-time').textContent =
    commitMaxTime.toLocaleString('en', dateTimeFormat);

  updateScatterPlot(data, filteredCommits);
  renderCommitInfo(
    filteredCommits.flatMap((d) => d.lines),
    filteredCommits,
  );
  renderBrushState();
}

function onTimeSliderChange() {
  commitProgress = Number(slider.value);
  updateToTime(timeScale.invert(commitProgress));
}

function updateFilesToTime(maxTime) {
  document.getElementById('files-time').textContent =
    'Code as of ' + maxTime.toLocaleString('en', dateTimeFormat);
  updateFileDisplay(filterUpTo(maxTime));
}

// ---------- Story text ----------

function countFiles(lines) {
  return d3.rollups(
    lines,
    (v) => v.length,
    (d) => d.file,
  ).length;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function renderScatterStory() {
  d3.select('#scatter-story')
    .selectAll('.step')
    .data(commits)
    .join('div')
    .attr('class', 'step')
    .html((d, i) => {
      const when = d.datetime.toLocaleString('en', {
        dateStyle: 'full',
        timeStyle: 'short',
      });
      const which =
        i === 0
          ? 'my first commit'
          : i === commits.length - 1
            ? 'my latest commit'
            : `commit ${i + 1} of ${commits.length}`;
      const biggest = d3.greatest(
        d3.rollups(d.lines, (v) => v.length, (l) => l.file),
        (f) => f[1],
      );

      return `
        <p class="step-date">${when}</p>
        <p>
          I made <a href="${d.url}" target="_blank">${which}</a>.
          ${plural(d.totalLines, 'line')} from it are still in the site today, spread over
          ${plural(countFiles(d.lines), 'file')}. Most of them landed in
          <code>${biggest[0]}</code>.
        </p>
      `;
    });
}

function renderFilesStory() {
  d3.select('#files-story')
    .selectAll('.step')
    .data(commits)
    .join('div')
    .attr('class', 'step')
    .html((d, i) => {
      const files = getFiles(commits.slice(0, i + 1));
      const totalLines = d3.sum(files, (f) => f.lines.length);
      const top = files[0];
      const share = d3.format('.0%')(top.lines.length / totalLines);
      const when = d.datetime.toLocaleString('en', { dateStyle: 'full' });

      return `
        <p class="step-date">${when}</p>
        <p>
          After <a href="${d.url}" target="_blank">this commit</a>, the site was
          ${plural(totalLines, 'line')} across ${plural(files.length, 'file')}.
          The biggest file was <code>${top.name}</code>, with ${share} of all the code.
        </p>
      `;
    });
}

// ---------- Run ----------

let data = await loadData();
let commits = processCommits(data);
filteredCommits = commits;

colors = d3
  .scaleOrdinal(d3.schemeTableau10)
  .domain(
    d3
      .rollups(
        data,
        (v) => v.length,
        (d) => d.type,
      )
      .sort((a, b) => b[1] - a[1])
      .map((d) => d[0]),
  );

timeScale = d3
  .scaleTime()
  .domain([
    d3.min(commits, (d) => d.datetime),
    d3.max(commits, (d) => d.datetime),
  ])
  .range([0, 100]);
commitMaxTime = timeScale.invert(commitProgress);

renderCommitInfo(data, commits);
renderScatterPlot(data, commits);

const slider = document.getElementById('commit-progress');
slider.addEventListener('input', onTimeSliderChange);
onTimeSliderChange();

renderFilesLegend(commits);
updateFilesToTime(commitMaxTime);

renderScatterStory();
renderFilesStory();

// Scrolling the story moves the cut-off to that commit's time
function onStepEnter(response) {
  const commitTime = response.element.__data__.datetime;
  slider.value = timeScale(commitTime);
  commitProgress = Number(slider.value);
  updateToTime(commitTime);
}

function onFilesStepEnter(response) {
  updateFilesToTime(response.element.__data__.datetime);
}

const scroller = scrollama();
scroller
  .setup({
    container: '#scrolly-1',
    step: '#scrolly-1 .step',
  })
  .onStepEnter(onStepEnter);

const filesScroller = scrollama();
filesScroller
  .setup({
    container: '#scrolly-2',
    step: '#scrolly-2 .step',
  })
  .onStepEnter(onFilesStepEnter);
