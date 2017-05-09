import React from 'react'
import _ from './utils'

export default Base => class extends Base {
  getResolvedState (props, state) {
    const resolvedState = {
      ..._.compactObject(this.state),
      ..._.compactObject(this.props),
      ..._.compactObject(state),
      ..._.compactObject(props)
    }
    return resolvedState
  }

  getDataModel (newState) {
    const {
      columns,
      pivotBy = [],
      data,
      pivotIDKey,
      pivotValKey,
      subRowsKey,
      aggregatedKey,
      nestingLevelKey,
      originalKey,
      indexKey,
      groupedByPivotKey,
      SubComponent
    } = newState

    // Determine Header Groups
    let hasHeaderGroups = false
    columns.forEach(column => {
      if (column.columns) {
        hasHeaderGroups = true
      }
    })

    let columnsWithExpander = [...columns]

    let expanderColumn = columns.find(col => col.expander || (col.columns && col.columns.some(col2 => col2.expander)))
    // The actual expander might be in the columns field of a group column
    if (expanderColumn && !expanderColumn.expander) {
      expanderColumn = expanderColumn.columns.find(col => col.expander)
    }

    // If we have SubComponent's we need to make sure we have an expander column
    if (SubComponent && !expanderColumn) {
      expanderColumn = {expander: true}
      columnsWithExpander = [expanderColumn, ...columnsWithExpander]
    }

    const makeDecoratedColumn = (column) => {
      let dcol
      if (column.expander) {
        dcol = {
          ...this.props.column,
          ...this.props.expanderDefaults,
          ...column
        }
      } else {
        dcol = {
          ...this.props.column,
          ...column
        }
      }

      if (typeof dcol.accessor === 'string') {
        dcol.id = dcol.id || dcol.accessor
        const accessorString = dcol.accessor
        dcol.accessor = row => _.get(row, accessorString)
        return dcol
      }

      if (dcol.accessor && !dcol.id) {
        console.warn(dcol)
        throw new Error('A column id is required if using a non-string accessor for column above.')
      }

      if (!dcol.accessor) {
        dcol.accessor = d => undefined
      }

      // Ensure minWidth is not greater than maxWidth if set
      if (dcol.maxWidth < dcol.minWidth) {
        dcol.minWidth = dcol.maxWidth
      }

      return dcol
    }

    // Decorate the columns
    const decorateAndAddToAll = (col) => {
      const decoratedColumn = makeDecoratedColumn(col)
      allDecoratedColumns.push(decoratedColumn)
      return decoratedColumn
    }
    let allDecoratedColumns = []
    const decoratedColumns = columnsWithExpander.map((column, i) => {
      if (column.columns) {
        return {
          ...column,
          columns: column.columns.map(decorateAndAddToAll)
        }
      } else {
        return decorateAndAddToAll(column)
      }
    })

    // Build the visible columns, headers and flat column list
    let visibleColumns = decoratedColumns.slice()
    let allVisibleColumns = []

    visibleColumns = visibleColumns.map((column, i) => {
      if (column.columns) {
        const visibleSubColumns = column.columns.filter(d => pivotBy.indexOf(d.id) > -1 ? false : _.getFirstDefined(d.show, true))
        return {
          ...column,
          columns: visibleSubColumns
        }
      }
      return column
    })

    visibleColumns = visibleColumns.filter(column => {
      return column.columns ? column.columns.length : pivotBy.indexOf(column.id) > -1 ? false : _.getFirstDefined(column.show, true)
    })

    // Find any custom pivot location
    const pivotIndex = visibleColumns.findIndex(col => col.pivot)

    // Handle Pivot Columns
    if (pivotBy.length) {
      // Retrieve the pivot columns in the correct pivot order
      const pivotColumns = []
      pivotBy.forEach(pivotID => {
        const found = allDecoratedColumns.find(d => d.id === pivotID)
        if (found) {
          pivotColumns.push(found)
        }
      })

      let pivotColumnGroup = {
        header: () => <strong>Group</strong>,
        columns: pivotColumns.map(col => ({
          ...this.props.pivotDefaults,
          ...col,
          pivot: true
        }))
      }

      // Place the pivotColumns back into the visibleColumns
      if (pivotIndex >= 0) {
        pivotColumnGroup = {
          ...visibleColumns[pivotIndex],
          ...pivotColumnGroup
        }
        visibleColumns.splice(pivotIndex, 1, pivotColumnGroup)
      } else {
        visibleColumns.unshift(pivotColumnGroup)
      }
    }

    // Build Header Groups
    const headerGroups = []
    let currentSpan = []

    // A convenience function to add a header and reset the currentSpan
    const addHeader = (columns, column) => {
      headerGroups.push({
        ...this.props.column,
        ...column,
        columns: columns
      })
      currentSpan = []
    }

    // Build flast list of allVisibleColumns and HeaderGroups
    visibleColumns.forEach((column, i) => {
      if (column.columns) {
        allVisibleColumns = allVisibleColumns.concat(column.columns)
        if (currentSpan.length > 0) {
          addHeader(currentSpan)
        }
        addHeader(column.columns, column)
        return
      }
      allVisibleColumns.push(column)
      currentSpan.push(column)
    })
    if (hasHeaderGroups && currentSpan.length > 0) {
      addHeader(currentSpan)
    }

    // Access the data
    const accessRow = (d, i, level = 0) => {
      const row = {
        [originalKey]: d,
        [indexKey]: i,
        [subRowsKey]: d[subRowsKey],
        [nestingLevelKey]: level
      }
      allDecoratedColumns.forEach(column => {
        if (column.expander) return
        row[column.id] = column.accessor(d)
      })
      if (row[subRowsKey]) {
        row[subRowsKey] = row[subRowsKey].map((d, i) => accessRow(d, i, level + 1))
      }
      return row
    }
    let resolvedData = data.map((d, i) => accessRow(d, i))

    // If pivoting, recursively group the data
    const aggregate = (rows) => {
      const aggregationValues = {}
      aggregatingColumns.forEach(column => {
        const values = rows.map(d => d[column.id])
        aggregationValues[column.id] = column.aggregate(values, rows)
      })
      return aggregationValues
    }

    // TODO: Make it possible to fabricate nested rows without pivoting
    const aggregatingColumns = allVisibleColumns.filter(d => !d.expander && d.aggregate)
    if (pivotBy.length) {
      const groupRecursively = (rows, keys, i = 0) => {
        // This is the last level, just return the rows
        if (i === keys.length) {
          return rows
        }
        // Group the rows together for this level
        let groupedRows = Object.entries(
          _.groupBy(rows, keys[i]))
        .map(([key, value]) => {
          return {
            [pivotIDKey]: keys[i],
            [pivotValKey]: key,
            [keys[i]]: key,
            [subRowsKey]: value,
            [nestingLevelKey]: i,
            [groupedByPivotKey]: true
          }
        })
        // Recurse into the subRows
        groupedRows = groupedRows.map(rowGroup => {
          let subRows = groupRecursively(rowGroup[subRowsKey], keys, i + 1)
          return {
            ...rowGroup,
            [subRowsKey]: subRows,
            [aggregatedKey]: true,
            ...aggregate(subRows)
          }
        })
        return groupedRows
      }
      resolvedData = groupRecursively(resolvedData, pivotBy)
    }

    return {
      ...newState,
      resolvedData,
      allVisibleColumns,
      headerGroups,
      allDecoratedColumns,
      hasHeaderGroups
    }
  }

  getSortedData (resolvedState) {
    const {
      manual,
      sorting,
      filters,
      showFilters,
      defaultFilterMethod,
      resolvedData,
      allVisibleColumns,
      allDecoratedColumns
    } = resolvedState

    const sortersByID = {}

    allDecoratedColumns
      .filter(col => col.sortMethod)
      .forEach(col => {
        sortersByID[col.id] = col.sortMethod
      })

    // Resolve the data from either manual data or sorted data
    return {
      sortedData: manual ? resolvedData : this.sortData(
        this.filterData(
          resolvedData,
          showFilters,
          filters,
          defaultFilterMethod,
          allVisibleColumns
        ),
        sorting,
        sortersByID
      )
    }
  }

  fireFetchData () {
    this.props.onFetchData(this.getResolvedState(), this)
  }

  getPropOrState (key) {
    return _.getFirstDefined(this.props[key], this.state[key])
  }

  getStateOrProp (key) {
    return _.getFirstDefined(this.state[key], this.props[key])
  }

  filterData (data, showFilters, filters, defaultFilterMethod, allVisibleColumns) {
    let filteredData = data

    if (showFilters && filters.length) {
      filteredData = filters.reduce(
        (filteredSoFar, nextFilter) => {
          return filteredSoFar.filter(
            (row) => {
              let column

              column = allVisibleColumns.find(x => x.id === nextFilter.id || (x.pivotColumns && x.pivotColumns.some(y => y.id === nextFilter.id)))

              // Could possibly be in pivotColumns
              if (column.id !== nextFilter.id && column.pivotColumns) {
                column = column.pivotColumns.find(x => x.id === nextFilter.id)
              }

              // Don't filter hidden columns
              if (!column) {
                return
              }

              const filterMethod = column.filterMethod || defaultFilterMethod

              return filterMethod(nextFilter, row, column)
            })
        }
        , filteredData
      )

      // Apply the filter to the subrows if we are pivoting, and then
      // filter any rows without subcolumns because it would be strange to show
      filteredData = filteredData.map(row => {
        if (!row[this.props.subRowsKey]) {
          return row
        }
        return {
          ...row,
          [this.props.subRowsKey]: this.filterData(row[this.props.subRowsKey], showFilters, filters, defaultFilterMethod, allVisibleColumns)
        }
      }).filter(row => {
        if (!row[this.props.subRowsKey]) {
          return true
        }
        return row[this.props.subRowsKey].length > 0
      })
    }

    return filteredData
  }

  sortData (data, sorting, sortersByID = {}) {
    if (!sorting.length) {
      return data
    }

    const sorted = _.orderBy(data, sorting.map(sort => {
      // Support custom sorting methods for each column
      if (sortersByID[sort.id]) {
        return row => {
          return sortersByID[sort.id](row[sort.id])
        }
      }
      return row => {
        return this.props.sortMethod[sort.id](row[sort.id])
      }
    }), sorting.map(d => !d.desc))

    return sorted.map(row => {
      if (!row[this.props.subRowsKey]) {
        return row
      }
      return {
        ...row,
        [this.props.subRowsKey]: this.sortData(row[this.props.subRowsKey], sorting, sortersByID)
      }
    })
  }

  getMinRows () {
    return _.getFirstDefined(this.props.minRows, this.getStateOrProp('pageSize'))
  }

  // User actions
  onPageChange (page) {
    const {onPageChange, collapseOnPageChange} = this.props
    onPageChange && onPageChange(page)
    // If controlled, do not keep track of state
    if (typeof this.props.page !== 'undefined') {
      this.fireFetchData()
      return
    }
    const newState = {page}
    if (collapseOnPageChange) {
      newState.expandedRows = {}
    }
    this.setStateWithData(newState, () => {
      this.fireFetchData()
    })
  }

  onPageSizeChange (newPageSize) {
    const {onPageSizeChange} = this.props
    const {pageSize, page} = this.getResolvedState()

    // Normalize the page to display
    const currentRow = pageSize * page
    const newPage = Math.floor(currentRow / newPageSize)

    onPageSizeChange && onPageSizeChange(newPageSize, newPage)
    if (typeof this.props.page !== 'undefined') {
      this.fireFetchData()
      return
    }

    this.setStateWithData({
      pageSize: newPageSize,
      page: newPage
    }, () => {
      this.fireFetchData()
    })
  }

  sortColumn (column, additive) {
    const {sorting, skipNextSort} = this.getResolvedState()

    // we can't stop event propagation from the column resize move handlers
    // attached to the document because of react's synthetic events
    // so we have to prevent the sort function from actually sorting
    // if we click on the column resize element within a header.
    if (skipNextSort) {
      this.setStateWithData({
        skipNextSort: false
      })
      return
    }

    const {onSortingChange} = this.props

    let newSorting = _.clone(sorting || []).map(d => {
      d.desc = _.isSortingDesc(d)
      return d
    })
    if (!_.isArray(column)) {
      // Single-Sort
      const existingIndex = newSorting.findIndex(d => d.id === column.id)
      if (existingIndex > -1) {
        const existing = newSorting[existingIndex]
        if (existing.desc) {
          if (additive) {
            newSorting.splice(existingIndex, 1)
          } else {
            existing.desc = false
            newSorting = [existing]
          }
        } else {
          existing.desc = true
          if (!additive) {
            newSorting = [existing]
          }
        }
      } else {
        if (additive) {
          newSorting.push({
            id: column.id,
            desc: false
          })
        } else {
          newSorting = [{
            id: column.id,
            desc: false
          }]
        }
      }
    } else {
      // Multi-Sort
      const existingIndex = newSorting.findIndex(d => d.id === column[0].id)
      // Existing Sorted Column
      if (existingIndex > -1) {
        const existing = newSorting[existingIndex]
        if (existing.desc) {
          if (additive) {
            newSorting.splice(existingIndex, column.length)
          } else {
            column.forEach((d, i) => {
              newSorting[existingIndex + i].desc = false
            })
          }
        } else {
          column.forEach((d, i) => {
            newSorting[existingIndex + i].desc = true
          })
        }
        if (!additive) {
          newSorting = newSorting.slice(existingIndex, column.length)
        }
      } else {
        // New Sort Column
        if (additive) {
          newSorting = newSorting.concat(column.map(d => ({
            id: d.id,
            desc: false
          })))
        } else {
          newSorting = column.map(d => ({
            id: d.id,
            desc: false
          }))
        }
      }
    }
    // If controlled, do not keep track of state
    onSortingChange && onSortingChange(newSorting, column, additive)
    if (typeof this.props.sorting !== 'undefined') {
      this.fireFetchData()
      return
    }
    this.setStateWithData({
      page: ((!sorting.length && newSorting.length) || !additive) ? 0 : this.state.page,
      sorting: newSorting
    }, () => {
      this.fireFetchData()
    })
  }

  filterColumn (column, value) {
    const {filters} = this.getResolvedState()
    const {onFiltersChange} = this.props

    // Remove old filter first if it exists
    const newFiltering = (filters || []).filter(x => {
      if (x.id !== column.id) {
        return true
      }
    })

    if (value !== '') {
      newFiltering.push({
        id: column.id,
        value: value
      })
    }

    onFiltersChange && onFiltersChange(newFiltering, column, value)

    // If filters is being controlled, do not manage state internally
    if (this.props.filters) {
      this.fireFetchData()
      return
    }

    this.setStateWithData({
      filters: newFiltering
    }, () => {
      this.fireFetchData()
    })
  }

  resizeColumnStart (column, event, isTouch) {
    const parentWidth = event.target.parentElement.getBoundingClientRect().width

    let pageX
    if (isTouch) {
      pageX = event.changedTouches[0].pageX
    } else {
      pageX = event.pageX
    }

    this.setStateWithData({
      currentlyResizing: {
        id: column.id,
        startX: pageX,
        parentWidth: parentWidth
      }
    }, () => {
      if (isTouch) {
        document.addEventListener('touchmove', this.resizeColumnMoving)
        document.addEventListener('touchcancel', this.resizeColumnEnd)
        document.addEventListener('touchend', this.resizeColumnEnd)
      } else {
        document.addEventListener('mousemove', this.resizeColumnMoving)
        document.addEventListener('mouseup', this.resizeColumnEnd)
        document.addEventListener('mouseleave', this.resizeColumnEnd)
      }
    })
  }

  resizeColumnEnd (event) {
    let isTouch = event.type === 'touchend' || event.type === 'touchcancel'

    if (isTouch) {
      document.removeEventListener('touchmove', this.resizeColumnMoving)
      document.removeEventListener('touchcancel', this.resizeColumnEnd)
      document.removeEventListener('touchend', this.resizeColumnEnd)
    }

    // If its a touch event clear the mouse one's as well because sometimes
    // the mouseDown event gets called as well, but the mouseUp event doesn't
    document.removeEventListener('mousemove', this.resizeColumnMoving)
    document.removeEventListener('mouseup', this.resizeColumnEnd)
    document.removeEventListener('mouseleave', this.resizeColumnEnd)

    // The touch events don't propagate up to the sorting's onMouseDown event so
    // no need to prevent it from happening or else the first click after a touch
    // event resize will not sort the column.
    if (!isTouch) {
      this.setStateWithData({
        skipNextSort: true,
        currentlyResizing: false
      })
    }
  }

  resizeColumnMoving (event) {
    const {onResize} = this.props
    const {resizing, currentlyResizing} = this.getResolvedState()

    // Delete old value
    const newResizing = resizing.filter(x => x.id !== currentlyResizing.id)

    let pageX

    if (event.type === 'touchmove') {
      pageX = event.changedTouches[0].pageX
    } else if (event.type === 'mousemove') {
      pageX = event.pageX
    }

    // Set the min size to 10 to account for margin and border or else the group headers don't line up correctly
    const newWidth = Math.max(currentlyResizing.parentWidth + pageX - currentlyResizing.startX, 11)

    newResizing.push({
      id: currentlyResizing.id,
      value: newWidth
    })

    onResize && onResize(newResizing, event)

    if (this.props.resizing) {
      return
    }

    this.setStateWithData({
      resizing: newResizing
    })
  }
}
